-- ============================================================
-- 0040 — Precio según la cantidad de personas
-- ============================================================
-- El precio era por unidad y por noche: lo mismo para 2 que para 5 personas.
-- Los dueños esperan lo que hace Booking: precio completo con la cabaña llena
-- y menos si se alojan menos. Existía una regla "Según huéspedes", pero compite
-- con las de fechas (en cada noche gana una sola): con un fin de semana largo
-- cargado, el ajuste por personas no se aplicaba. Ningún cliente la usaba.
--
-- Ahora cada unidad tiene, aparte de las reglas, un ajuste por cantidad de
-- personas que se aplica ENCIMA del precio de cada noche (base, temporada,
-- fecha especial…). Dos formas de cargarlo:
--   percent: "20% menos"  → precio de la noche × (1 − 20%).
--   fixed:   "$100.000"   → en una noche a precio base cobra exactamente eso;
--                           en una noche con otro precio, la misma proporción
--                           (100.000 / base). Así no hay que cargar un precio
--                           fijo por cada temporada.
-- Sin nada cargado para esa cantidad de personas, el precio no cambia: los
-- complejos que no lo configuran siguen cobrando igual que antes.
--
-- _unit_price_night es el único punto por donde pasan la reserva (_book), la
-- disponibilidad pública y el simulador: el ajuste queda igual en los tres.
-- ============================================================

create table public.unit_guest_prices (
  unit_id         uuid not null references public.units(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  guests          int  not null check (guests between 1 and 50),
  mode            text not null check (mode in ('percent', 'fixed')),
  value           numeric(12, 2) not null,
  updated_at      timestamptz not null default now(),
  primary key (unit_id, guests),
  constraint unit_guest_prices_value_chk check (
    (mode = 'percent' and value > 0 and value < 100) or (mode = 'fixed' and value > 0)
  )
);
create index unit_guest_prices_org_idx on public.unit_guest_prices (organization_id);

alter table public.unit_guest_prices enable row level security;
revoke all on public.unit_guest_prices from anon, authenticated;
grant select on public.unit_guest_prices to authenticated;
grant all on public.unit_guest_prices to service_role;
-- Lectura para el equipo; se escribe solo por la RPC de abajo.
create policy unit_guest_prices_select on public.unit_guest_prices for select to authenticated
  using (public.is_member_of(organization_id));

-- Reemplaza todos los ajustes de una unidad. Mismo permiso que las tarifas:
-- dueño o administrador (is_admin_of), no staff.
-- p_tiers: [{ "guests": 2, "mode": "percent" | "fixed", "value": 20 }, …]
create function public.set_unit_guest_prices(p_unit uuid, p_tiers jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_unit public.units; v_tier jsonb; v_guests int; v_mode text; v_value numeric; v_seen int[] := '{}'; v_count int := 0;
begin
  select * into v_unit from public.units where id = p_unit;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  if not public.is_admin_of(v_unit.organization_id) then raise exception 'FORBIDDEN'; end if;
  if coalesce(jsonb_typeof(p_tiers), '') <> 'array' or jsonb_array_length(p_tiers) > 50 then
    raise exception 'INVALID_TIERS';
  end if;

  delete from public.unit_guest_prices where unit_id = p_unit;

  for v_tier in select value from jsonb_array_elements(p_tiers) loop
    begin
      v_guests := (v_tier->>'guests')::int;
      v_value  := (v_tier->>'value')::numeric;
    exception when others then
      raise exception 'INVALID_TIERS';
    end;
    v_mode := v_tier->>'mode';
    -- Solo cantidades que entran en la unidad, sin repetir.
    if v_guests is null or v_guests < 1 or v_guests > v_unit.capacity or v_guests = any (v_seen) then
      raise exception 'INVALID_GUESTS';
    end if;
    if v_mode is null or v_mode not in ('percent', 'fixed') then raise exception 'INVALID_MODE'; end if;
    if v_value is null or v_value <= 0 or v_value <> round(v_value, 2) or v_value >= 10000000000
       or (v_mode = 'percent' and v_value >= 100) then
      raise exception 'INVALID_VALUE';
    end if;
    v_seen := v_seen || v_guests;

    insert into public.unit_guest_prices (unit_id, organization_id, guests, mode, value)
    values (p_unit, v_unit.organization_id, v_guests, v_mode, v_value);
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke execute on function public.set_unit_guest_prices(uuid, jsonb) from public, anon;
grant execute on function public.set_unit_guest_prices(uuid, jsonb) to authenticated;

-- ---------- Motor de precios ----------
-- El precio de la noche ANTES del ajuste por personas: exactamente lo que
-- hacía _unit_price_night hasta 0039 (verificado contra producción).
create function public._unit_price_before_guests(
  p_unit uuid, p_day date, p_guests int, p_nights int
) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base numeric;
  v_rule public.rates;
begin
  v_base := public._unit_base_price(p_unit, p_day);
  if v_base is null then return null; end if;   -- sin tarifa base no hay precio

  v_rule := public._unit_rule_for_night(p_unit, p_day, p_guests, p_nights);
  if v_rule.id is null then return v_base; end if;

  if v_rule.price_per_night is not null then
    return v_rule.price_per_night;
  end if;
  -- Descuento porcentual sobre la base de esa misma noche.
  return round(v_base * (1 - v_rule.discount_pct / 100), 2);
end; $$;

create or replace function _unit_price_night(
  p_unit uuid, p_day date, p_guests int, p_nights int
) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_price numeric;
  v_base  numeric;
  v_tier  public.unit_guest_prices;
begin
  v_price := public._unit_price_before_guests(p_unit, p_day, p_guests, p_nights);
  if v_price is null then return null; end if;

  -- Sin cantidad de personas (o sin ajuste cargado para esa cantidad): precio completo.
  select * into v_tier from public.unit_guest_prices t
   where t.unit_id = p_unit and t.guests = p_guests;
  if not found then return v_price; end if;

  if v_tier.mode = 'percent' then
    return round(v_price * (1 - v_tier.value / 100), 2);
  end if;

  -- Precio fijo: es el precio de una noche a tarifa base. En una noche con
  -- otro precio se conserva la proporción.
  v_base := public._unit_base_price(p_unit, p_day);
  if v_base is null or v_base = 0 or v_price = v_base then return v_tier.value; end if;
  return round(v_price * v_tier.value / v_base, 2);
end; $$;

revoke execute on function public._unit_price_before_guests(uuid, date, int, int) from public, anon, authenticated;

-- ---------- Simulador ----------
-- Copia de 0022 (verificada contra producción) más: el precio de cada noche
-- antes del ajuste, el ajuste aplicado, y la capacidad de la unidad para
-- avisar cuando se simula con más personas de las que entran.
create or replace function simulate_price(
  p_unit uuid, p_check_in date, p_check_out date, p_guests int
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit public.units;
  v_nights int;
  v_rows jsonb;
  v_total numeric;
  v_tier public.unit_guest_prices;
begin
  select * into v_unit from public.units where id = p_unit;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  if not public.is_member_of(v_unit.organization_id) then raise exception 'FORBIDDEN'; end if;
  if p_check_out <= p_check_in then raise exception 'INVALID_DATES'; end if;

  v_nights := p_check_out - p_check_in;

  select * into v_tier from public.unit_guest_prices t
   where t.unit_id = p_unit and t.guests = p_guests;

  select jsonb_agg(x order by x->>'day'), sum((x->>'price')::numeric)
    into v_rows, v_total
  from (
    select jsonb_build_object(
             'day', d::date,
             'price', public._unit_price_night(p_unit, d::date, p_guests, v_nights),
             'price_before_guests', public._unit_price_before_guests(p_unit, d::date, p_guests, v_nights),
             'base', public._unit_base_price(p_unit, d::date),
             'rule', (
               select case when r.id is null then null else
                 jsonb_build_object(
                   'id', r.id, 'label', r.label, 'kind', r.kind,
                   'discount_pct', r.discount_pct, 'price', r.price_per_night)
               end
               from public._unit_rule_for_night(p_unit, d::date, p_guests, v_nights) r
             )
           ) as x
    from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
  ) t;

  return jsonb_build_object(
    'unit_id', p_unit,
    'nights', v_nights,
    'min_nights', public._min_nights_required(p_unit, p_check_in, p_check_out, p_guests),
    'total', v_total,
    'currency', (select currency from public.properties where id = v_unit.property_id),
    'breakdown', coalesce(v_rows, '[]'::jsonb),
    'guests', p_guests,
    'capacity', v_unit.capacity,
    'guest_price', case when v_tier.unit_id is null then null
                        else jsonb_build_object('mode', v_tier.mode, 'value', v_tier.value) end
  );
end; $$;
