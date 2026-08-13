-- ============================================================
-- Operon Reservas — Motor de disponibilidad y reservas
-- ============================================================
-- Reglas clave:
--  * Disponibilidad = ausencia de solape en unit_occupancy (única fuente de verdad).
--  * Anti-doble-reserva garantizado por la restricción EXCLUDE (0001), no por
--    "consultamos antes": la creación reintenta el insert y si hay solape, falla.
--  * Máquina de estados centralizada en _can_transition (una sola definición).
--  * Acceso público SOLO por estas RPC SECURITY DEFINER, con campos públicos.
-- ============================================================

-- ---------- Reglas puras ----------
create or replace function holds_inventory(s reservation_status) returns boolean
language sql immutable set search_path = '' as $$
  select s in ('pending','pending_payment','confirmed','completed');
$$;

-- Transiciones permitidas (fuente única de verdad de estados)
create or replace function _can_transition(p_from reservation_status, p_to reservation_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'inquiry'         then p_to in ('pending','pending_payment','cancelled')
    when 'pending'         then p_to in ('pending_payment','confirmed','cancelled')
    when 'pending_payment' then p_to in ('confirmed','cancelled')
    when 'confirmed'       then p_to in ('completed','cancelled')
    else false   -- completed / cancelled son terminales
  end;
$$;

-- ---------- Precio por noche aplicable (simple; crece a estacional/especial) ----------
create or replace function _unit_price(p_unit uuid, p_check_in date, p_check_out date)
returns numeric language sql stable security definer set search_path = '' as $$
  select r.price_per_night
  from public.rates r
  join public.units u on u.id = p_unit
  where u.id = p_unit
    and r.organization_id = u.organization_id
    and r.property_id = u.property_id
    and (r.unit_id = p_unit or r.unit_id is null)
    and ( r.kind = 'base'
          or (r.start_date <= p_check_in and r.end_date >= p_check_out) )
  order by (r.unit_id is not null) desc,   -- tarifa específica de unidad gana
           (r.kind <> 'base') desc,        -- estacional/especial gana sobre base
           r.priority desc
  limit 1;
$$;

-- ---------- Upsert de huésped (dedupe por org+email; nunca por nombre) ----------
create or replace function _upsert_guest(p_org uuid, p_name text, p_email text, p_phone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare gid uuid; v_email text;
begin
  v_email := nullif(lower(trim(p_email)), '');
  if v_email is not null then
    insert into public.guests (organization_id, full_name, email, phone)
    values (p_org, p_name, v_email, p_phone)
    on conflict (organization_id, lower(email)) where email is not null
      do update set full_name  = excluded.full_name,
                    phone      = coalesce(excluded.phone, public.guests.phone),
                    updated_at = now()
    returning id into gid;
  else
    insert into public.guests (organization_id, full_name, phone)
    values (p_org, p_name, p_phone) returning id into gid;
  end if;
  return gid;
end; $$;

-- ---------- Resolver property pública a partir del slug de org (+ property opcional) ----------
create or replace function _resolve_property(p_org_slug text, p_property_slug text)
returns public.properties language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_prop public.properties; v_count int;
begin
  select id into v_org from public.organizations where slug = p_org_slug;
  if v_org is null then raise exception 'ORG_NOT_FOUND'; end if;

  if p_property_slug is not null then
    select * into v_prop from public.properties
     where organization_id = v_org and slug = p_property_slug and is_active = true;
    if not found then raise exception 'PROPERTY_NOT_FOUND'; end if;
  else
    select count(*) into v_count from public.properties
     where organization_id = v_org and is_active = true;
    if v_count = 0 then raise exception 'PROPERTY_NOT_FOUND'; end if;
    if v_count > 1 then raise exception 'PROPERTY_AMBIGUOUS'; end if;
    select * into v_prop from public.properties
     where organization_id = v_org and is_active = true;
  end if;
  return v_prop;
end; $$;

-- ============================================================
-- NÚCLEO: crear reserva (transaccional, race-safe)
-- La restricción EXCLUDE de unit_occupancy es el árbitro final.
-- ============================================================
create or replace function _book(
  p_org uuid, p_property uuid, p_unit uuid, p_guest_id uuid,
  p_check_in date, p_check_out date, p_guests int,
  p_status reservation_status, p_source reservation_source,
  p_created_by uuid, p_hold_minutes int
) returns public.reservations
language plpgsql security definer set search_path = '' as $$
declare v_unit public.units; v_res public.reservations; v_code text;
begin
  if p_check_out <= p_check_in then raise exception 'INVALID_DATES'; end if;

  select * into v_unit from public.units
   where id = p_unit and property_id = p_property
     and organization_id = p_org and is_active = true;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  if p_guests > v_unit.capacity then raise exception 'OVER_CAPACITY'; end if;

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
      raise exception 'UNAVAILABLE';   -- aborta toda la transacción → sin reserva fantasma
    end;
  end if;

  return v_res;
end; $$;

-- ============================================================
-- API PÚBLICA (anon) — solo campos públicos
-- ============================================================

-- Disponibilidad: unidades libres para el rango, con precio público.
create or replace function public_availability(
  p_org_slug text, p_property_slug text,
  p_check_in date, p_check_out date, p_guests int
) returns table (unit_id uuid, name text, description text, capacity int,
                 price_per_night numeric, currency text)
language plpgsql stable security definer set search_path = '' as $$
declare v_prop public.properties;
begin
  v_prop := public._resolve_property(p_org_slug, p_property_slug);
  if p_check_out <= p_check_in then raise exception 'INVALID_DATES'; end if;

  return query
  select u.id, u.name, u.description, u.capacity,
         public._unit_price(u.id, p_check_in, p_check_out), v_prop.currency
  from public.units u
  where u.property_id = v_prop.id
    and u.is_active = true
    and u.capacity >= coalesce(p_guests, 1)
    and not exists (
      select 1 from public.unit_occupancy o
      where o.unit_id = u.id
        and o.during && daterange(p_check_in, p_check_out, '[)')
    )
  order by u.position, u.name;
end; $$;

-- Info pública de la property (nombre, horarios, moneda). Sin datos privados.
create or replace function public_property(p_org_slug text, p_property_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_prop public.properties;
begin
  v_prop := public._resolve_property(p_org_slug, p_property_slug);
  return jsonb_build_object(
    'name', v_prop.name, 'description', v_prop.description,
    'city', v_prop.city, 'currency', v_prop.currency,
    'checkin_time', v_prop.checkin_time, 'checkout_time', v_prop.checkout_time
  );
end; $$;

-- Crear reserva desde la web pública (source=direct, con retención de 30').
-- Re-valida disponibilidad en el guardado; nunca confía en el front.
create or replace function create_public_reservation(
  p_org_slug text, p_property_slug text, p_unit_id uuid,
  p_check_in date, p_check_out date, p_guests int,
  p_full_name text, p_email text, p_phone text, p_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prop public.properties; v_guest uuid; v_res public.reservations;
begin
  v_prop := public._resolve_property(p_org_slug, p_property_slug);
  v_guest := public._upsert_guest(v_prop.organization_id, p_full_name, p_email, p_phone);

  v_res := public._book(
    v_prop.organization_id, v_prop.id, p_unit_id, v_guest,
    p_check_in, p_check_out, p_guests, 'pending', 'direct', null, 30
  );

  if nullif(trim(p_notes), '') is not null then
    update public.reservations set notes = p_notes where id = v_res.id;
  end if;

  return jsonb_build_object('ok', true, 'code', v_res.code, 'status', v_res.status,
                            'check_in', v_res.check_in, 'check_out', v_res.check_out);
end; $$;

-- ============================================================
-- API PANEL (authenticated) — acotada a la org por membership
-- ============================================================

-- Reserva cargada manualmente por el admin (source=manual).
create or replace function create_manual_reservation(
  p_org uuid, p_property uuid, p_unit uuid,
  p_full_name text, p_email text, p_phone text,
  p_check_in date, p_check_out date, p_guests int,
  p_status reservation_status, p_notes text
) returns public.reservations language plpgsql security definer set search_path = '' as $$
declare v_guest uuid; v_res public.reservations;
begin
  if not public.is_member_of(p_org) then raise exception 'FORBIDDEN'; end if;
  v_guest := public._upsert_guest(p_org, p_full_name, p_email, p_phone);
  v_res := public._book(p_org, p_property, p_unit, v_guest,
                        p_check_in, p_check_out, p_guests,
                        coalesce(p_status,'confirmed'), 'manual', auth.uid(), null);
  if nullif(trim(p_notes), '') is not null then
    update public.reservations set notes = p_notes where id = v_res.id returning * into v_res;
  end if;
  return v_res;
end; $$;

-- Bloqueo manual de fechas (mantenimiento, uso propio, etc.). Resta disponibilidad igual que una reserva.
create or replace function create_block(
  p_org uuid, p_unit uuid, p_start date, p_end date, p_reason text
) returns public.unit_occupancy language plpgsql security definer set search_path = '' as $$
declare v_row public.unit_occupancy;
begin
  if not public.is_member_of(p_org) then raise exception 'FORBIDDEN'; end if;
  if p_end <= p_start then raise exception 'INVALID_DATES'; end if;
  if not exists (select 1 from public.units where id = p_unit and organization_id = p_org) then
    raise exception 'UNIT_NOT_FOUND';
  end if;
  begin
    insert into public.unit_occupancy (organization_id, unit_id, during, kind, block_reason, created_by)
    values (p_org, p_unit, daterange(p_start, p_end, '[)'), 'block', p_reason, auth.uid())
    returning * into v_row;
  exception when exclusion_violation then raise exception 'UNAVAILABLE'; end;
  return v_row;
end; $$;

-- Transición de estado centralizada + gestión de ocupación.
create or replace function transition_reservation(p_reservation uuid, p_to reservation_status)
returns reservation_status language plpgsql security definer set search_path = '' as $$
declare v public.reservations;
begin
  select * into v from public.reservations where id = p_reservation;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.is_member_of(v.organization_id) then raise exception 'FORBIDDEN'; end if;
  if not public._can_transition(v.status, p_to) then raise exception 'INVALID_TRANSITION'; end if;

  if public.holds_inventory(p_to) and not public.holds_inventory(v.status) then
    begin
      insert into public.unit_occupancy
        (organization_id, unit_id, during, kind, reservation_id, created_by)
      values (v.organization_id, v.unit_id, daterange(v.check_in, v.check_out, '[)'),
              'reservation', v.id, auth.uid());
    exception when exclusion_violation then raise exception 'UNAVAILABLE'; end;
  elsif public.holds_inventory(v.status) and not public.holds_inventory(p_to) then
    delete from public.unit_occupancy where reservation_id = v.id;  -- libera fechas
  end if;

  update public.reservations
     set status = p_to,
         hold_expires_at = case when p_to in ('confirmed','completed') then null else hold_expires_at end
   where id = v.id;
  return p_to;
end; $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public._book(uuid,uuid,uuid,uuid,date,date,int,reservation_status,reservation_source,uuid,int) from public;
revoke execute on function public._upsert_guest(uuid,text,text,text) from public;
revoke execute on function public._resolve_property(text,text) from public;
revoke execute on function public._unit_price(uuid,date,date) from public;

grant execute on function public.public_availability(text,text,date,date,int)                to anon, authenticated;
grant execute on function public.public_property(text,text)                                  to anon, authenticated;
grant execute on function public.create_public_reservation(text,text,uuid,date,date,int,text,text,text,text) to anon, authenticated;

grant execute on function public.create_manual_reservation(uuid,uuid,uuid,text,text,text,date,date,int,reservation_status,text) to authenticated;
grant execute on function public.create_block(uuid,uuid,date,date,text)                      to authenticated;
grant execute on function public.transition_reservation(uuid,reservation_status)             to authenticated;
