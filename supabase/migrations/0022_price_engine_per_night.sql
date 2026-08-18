-- ============================================================
-- Operon Reservas — Motor de precios NOCHE POR NOCHE
-- ============================================================
-- Reemplaza a `_unit_price` (0003), que tenía dos defectos serios:
--
--  1. Sólo aplicaba una tarifa de temporada si cubría la estadía ENTERA
--     (start_date <= check_in AND end_date >= check_out). Una reserva que
--     cruzaba el fin de la temporada caía a tarifa base y cobraba de menos,
--     en silencio.
--  2. `min_nights` se guardaba pero no lo validaba nadie: se podía exigir
--     3 noches y reservar 1.
--
-- Ahora cada noche resuelve su propio precio y se suman. Además el mínimo de
-- noches se valida en `_book`, que es por donde pasan TODAS las reservas
-- (web pública y carga manual).
--
-- Convención de fechas: `start_date`/`end_date` son inclusivas y se comparan
-- contra la NOCHE. Una temporada 01/07–31/07 cubre las noches del 1 al 31 de
-- julio; la noche del 31 es la última (el huésped se va el 1/8).
-- ============================================================

-- ---------- Precio base de una noche ----------
create or replace function _unit_base_price(p_unit uuid, p_day date)
returns numeric
language sql stable security definer set search_path = '' as $$
  select r.price_per_night
  from public.rates r
  join public.units u on u.id = p_unit
  where r.organization_id = u.organization_id
    and r.property_id = u.property_id
    and (r.unit_id = p_unit or r.unit_id is null)
    and r.kind = 'base'
    and r.is_active
  -- La tarifa propia de la unidad gana sobre la de toda la propiedad.
  order by (r.unit_id is not null) desc, r.priority desc
  limit 1;
$$;

-- ---------- Regla que gobierna una noche ----------
-- Devuelve la fila de `rates` ganadora, o NULL si esa noche va a precio base.
create or replace function _unit_rule_for_night(
  p_unit uuid, p_day date, p_guests int, p_nights int
) returns public.rates
language sql stable security definer set search_path = '' as $$
  select r.*
  from public.rates r
  join public.units u on u.id = p_unit
  where r.organization_id = u.organization_id
    and r.property_id = u.property_id
    and (r.unit_id = p_unit or r.unit_id is null)
    and r.kind <> 'base'
    and r.is_active
    -- Vigencia: la noche cae dentro del rango (extremos inclusive).
    and (r.start_date is null or p_day >= r.start_date)
    and (r.end_date   is null or p_day <= r.end_date)
    -- Día de la semana (0=domingo), NULL = todos.
    and (r.weekdays is null
         or extract(dow from p_day)::smallint = any(r.weekdays))
    -- Tamaño del grupo.
    and (r.min_guests is null or coalesce(p_guests, 1) >= r.min_guests)
    and (r.max_guests is null or coalesce(p_guests, 1) <= r.max_guests)
    -- Largo de la estadía (descuento por estadía larga).
    and (r.min_nights_rule is null or coalesce(p_nights, 1) >= r.min_nights_rule)
  order by r.priority desc,
           (r.unit_id is not null) desc,   -- más específica primero
           (r.weekdays is not null) desc,
           r.created_at desc               -- desempate estable
  limit 1;
$$;

-- ---------- Precio de UNA noche, ya con la regla aplicada ----------
create or replace function _unit_price_night(
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

-- ---------- Total de la estadía ----------
create or replace function _unit_stay_price(
  p_unit uuid, p_check_in date, p_check_out date, p_guests int
) returns numeric
language sql stable security definer set search_path = '' as $$
  -- Si a alguna noche le falta precio, el total es NULL: mejor no cobrar
  -- nada que cobrar una estadía a medias.
  select case
           when count(*) filter (where n.price is null) > 0 then null
           else sum(n.price)
         end
  from (
    select public._unit_price_night(
             p_unit, d::date, p_guests, (p_check_out - p_check_in)
           ) as price
    from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
  ) n;
$$;

-- ---------- Mínimo de noches exigido ----------
create or replace function _min_nights_required(
  p_unit uuid, p_check_in date, p_check_out date, p_guests int
) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(r.min_nights), 1)
  from public.rates r
  join public.units u on u.id = p_unit
  where r.organization_id = u.organization_id
    and r.property_id = u.property_id
    and (r.unit_id = p_unit or r.unit_id is null)
    and r.is_active
    -- Alcanza con que la regla toque UNA noche de la estadía.
    and (r.start_date is null or r.start_date < p_check_out)
    and (r.end_date   is null or r.end_date  >= p_check_in)
    and (r.min_guests is null or coalesce(p_guests, 1) >= r.min_guests)
    and (r.max_guests is null or coalesce(p_guests, 1) <= r.max_guests);
$$;

-- ============================================================
-- _book: usa el total por noche y valida el mínimo
-- ============================================================
create or replace function _book(
  p_org uuid, p_property uuid, p_unit uuid, p_guest_id uuid,
  p_check_in date, p_check_out date, p_guests int,
  p_status reservation_status, p_source reservation_source,
  p_created_by uuid, p_hold_minutes int
) returns public.reservations
language plpgsql security definer set search_path = '' as $$
declare
  v_unit public.units; v_res public.reservations; v_code text;
  v_nights int; v_total numeric; v_deposit_pct numeric; v_currency text;
  v_min_nights int;
begin
  if p_check_out <= p_check_in then raise exception 'INVALID_DATES'; end if;

  select * into v_unit from public.units
   where id = p_unit and property_id = p_property
     and organization_id = p_org and is_active = true;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  if p_guests > v_unit.capacity then raise exception 'OVER_CAPACITY'; end if;

  v_nights := p_check_out - p_check_in;

  -- Estadía mínima. Se valida ANTES de tomar el inventario para no dejar
  -- una ocupación colgada si la reserva se rechaza.
  v_min_nights := public._min_nights_required(p_unit, p_check_in, p_check_out, p_guests);
  if v_nights < v_min_nights then
    raise exception 'MIN_NIGHTS:%', v_min_nights;
  end if;

  v_code := 'R-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));

  insert into public.reservations (
    organization_id, property_id, unit_id, guest_id, code,
    check_in, check_out, guests_count, status, source, hold_expires_at, created_by
  ) values (
    p_org, p_property, p_unit, p_guest_id, v_code,
    p_check_in, p_check_out, p_guests, p_status, p_source,
    case when p_hold_minutes is not null
         then now() + make_interval(mins => p_hold_minutes) end,
    p_created_by
  ) returning * into v_res;

  if public.holds_inventory(p_status) then
    begin
      insert into public.unit_occupancy
        (organization_id, unit_id, during, kind, reservation_id, created_by)
      values
        (p_org, p_unit, daterange(p_check_in, p_check_out, '[)'), 'reservation', v_res.id, p_created_by);
    exception when exclusion_violation then
      raise exception 'UNAVAILABLE';
    end;
  end if;

  -- Precio: suma noche por noche (ya no un precio único por toda la estadía).
  v_total := public._unit_stay_price(p_unit, p_check_in, p_check_out, p_guests);
  if v_total is not null then
    select deposit_pct, currency into v_deposit_pct, v_currency
      from public.properties where id = p_property;
    update public.reservations
       set total_amount   = v_total,
           deposit_amount = case when coalesce(v_deposit_pct,0) > 0
                                 then round(v_total * v_deposit_pct / 100) else null end,
           currency       = coalesce(v_currency, currency)
     where id = v_res.id
     returning * into v_res;
  end if;

  return v_res;
end; $$;

-- ============================================================
-- Disponibilidad pública: total real de la estadía + mínimo de noches
-- ============================================================
-- Cambia el tipo de retorno, así que hay que recrearla.
drop function if exists public_availability(text, text, date, date, int);

create or replace function public_availability(
  p_org_slug text, p_property_slug text,
  p_check_in date, p_check_out date, p_guests int
) returns table (unit_id uuid, name text, description text, capacity int,
                 price_per_night numeric, total_price numeric,
                 min_nights int, currency text)
language plpgsql stable security definer set search_path = '' as $$
declare v_prop public.properties; v_nights int;
begin
  v_prop := public._resolve_property(p_org_slug, p_property_slug);
  if p_check_out <= p_check_in then raise exception 'INVALID_DATES'; end if;
  v_nights := p_check_out - p_check_in;

  return query
  select u.id, u.name, u.description, u.capacity,
         -- "Desde": el precio de la primera noche, para mostrar por noche.
         public._unit_price_night(u.id, p_check_in, p_guests, v_nights),
         public._unit_stay_price(u.id, p_check_in, p_check_out, p_guests),
         public._min_nights_required(u.id, p_check_in, p_check_out, p_guests),
         v_prop.currency
  from public.units u
  where u.property_id = v_prop.id
    and u.is_active = true
    and u.capacity >= coalesce(p_guests, 1)
    -- Se ocultan las unidades que exigen más noches de las pedidas: mostrar
    -- una opción que después va a ser rechazada al reservar es peor que no
    -- mostrarla.
    and v_nights >= public._min_nights_required(u.id, p_check_in, p_check_out, p_guests)
    and not exists (
      select 1 from public.unit_occupancy o
      where o.unit_id = u.id
        and o.during && daterange(p_check_in, p_check_out, '[)')
    )
  order by u.position, u.name;
end; $$;

-- ============================================================
-- Simulador para el panel: desglose noche por noche
-- ============================================================
create or replace function simulate_price(
  p_unit uuid, p_check_in date, p_check_out date, p_guests int
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit public.units;
  v_nights int;
  v_rows jsonb;
  v_total numeric;
begin
  select * into v_unit from public.units where id = p_unit;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  if not public.is_member_of(v_unit.organization_id) then raise exception 'FORBIDDEN'; end if;
  if p_check_out <= p_check_in then raise exception 'INVALID_DATES'; end if;

  v_nights := p_check_out - p_check_in;

  select jsonb_agg(x order by x->>'day'), sum((x->>'price')::numeric)
    into v_rows, v_total
  from (
    select jsonb_build_object(
             'day', d::date,
             'price', public._unit_price_night(p_unit, d::date, p_guests, v_nights),
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
    'breakdown', coalesce(v_rows, '[]'::jsonb)
  );
end; $$;

-- ---------- Permisos ----------
revoke execute on function public._unit_base_price(uuid,date) from public, anon, authenticated;
revoke execute on function public._unit_rule_for_night(uuid,date,int,int) from public, anon, authenticated;
revoke execute on function public._unit_price_night(uuid,date,int,int) from public, anon, authenticated;
revoke execute on function public._unit_stay_price(uuid,date,date,int) from public, anon, authenticated;
revoke execute on function public._min_nights_required(uuid,date,date,int) from public, anon, authenticated;
revoke execute on function public._book(uuid,uuid,uuid,uuid,date,date,int,reservation_status,reservation_source,uuid,int) from public, anon, authenticated;

grant execute on function public.public_availability(text,text,date,date,int) to anon, authenticated;
grant execute on function public.simulate_price(uuid,date,date,int) to authenticated;

-- El motor viejo queda sin uso; se elimina para que nadie lo llame por error.
drop function if exists _unit_price(uuid, date, date);
