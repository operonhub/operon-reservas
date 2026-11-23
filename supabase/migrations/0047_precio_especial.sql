-- ============================================================
-- 0047 — Precio especial en reservas cargadas desde el panel
-- ============================================================
-- Hasta acá el total de una reserva lo calculaba siempre el motor de tarifas
-- (sleep 0005/0022). El dueño no tenía forma de dejar una estadía a un precio
-- distinto para un familiar, un amigo o un canje.
--
-- Decisiones de producto:
--
--  * El precio especial es el TOTAL de la estadía, no un valor por noche.
--    Es lo que uno dice: "te la dejo en X".
--  * El precio que calculó el sistema se guarda igual en `list_amount`, para
--    poder mostrar cuánto se bonificó y para auditoría.
--  * El precio de lista no se pierde al editar: se recalcula con las tarifas
--    vigentes (si cambian las fechas o las tarifas) pero nunca se pisa con el
--    especial.
--  * La seña se recalcula con el mismo porcentaje del complejo sobre el total
--    especial. Una estadía sin cargo deja la seña en 0.
--  * $0 se permite (invitación/canje) pero exige motivo: es el único caso en
--    que un valor en cero puede ser un error de carga y no una decisión.
--  * Solo dueño o administrador puede fijar, cambiar o quitar el precio
--    especial. El resto del equipo sigue pudiendo crear y editar reservas.
--  * Cada alta, cambio o baja de precio deja una entrada 'priced' en el
--    historial, con quién, de cuánto a cuánto y el motivo.
-- ============================================================

-- ---------- 1) Dónde vive el precio especial ----------
alter table public.reservations
  add column if not exists list_amount          numeric,
  add column if not exists price_override       boolean not null default false,
  add column if not exists price_override_note  text;

comment on column public.reservations.list_amount is
  'Total que calculó el motor de tarifas. Referencia del precio de lista, aun cuando se haya aplicado un precio especial.';
comment on column public.reservations.price_override is
  'true si el total lo fijó a mano un dueño o administrador.';
comment on column public.reservations.price_override_note is
  'Motivo del precio especial (familia, amigo, canje…). Obligatorio solo cuando el total es 0.';

-- Las reservas anteriores al precio especial nunca fueron un precio fijado
-- a mano: su total ES el precio de lista.
update public.reservations
   set list_amount = total_amount
 where list_amount is null
   and total_amount is not null;

-- ---------- 2) El historial ahora registra precios ----------
alter table app_private.reservation_audit
  drop constraint if exists reservation_audit_action_check;
alter table app_private.reservation_audit
  add constraint reservation_audit_action_check
  check (action in ('updated', 'cancelled', 'reopened', 'deleted', 'priced'));

-- ---------- 3) Validación del precio especial ----------
-- Devuelve el motivo ya normalizado. Un total en 0 sin motivo se rechaza:
-- es el único cero que puede ser un accidente.
create or replace function public._checked_price_note(p_total numeric, p_note text)
returns text
language plpgsql immutable set search_path = '' as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_total is null then return null; end if;
  if p_total < 0 then raise exception 'INVALID_PRICE'; end if;
  if p_total = 0 and v_note is null then raise exception 'FREE_REASON_REQUIRED'; end if;
  return left(v_note, 120);
end; $$;
revoke all on function public._checked_price_note(numeric, text) from public, anon, authenticated;

-- ---------- 4) _book: toda reserva nace con precio de lista ----------
-- Misma función de 0022, con una sola diferencia: además de total_amount
-- guarda list_amount, el precio que calculó el motor.
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

  -- Precio: suma noche por noche. list_amount es la referencia del sistema.
  v_total := public._unit_stay_price(p_unit, p_check_in, p_check_out, p_guests);
  if v_total is not null then
    select deposit_pct, currency into v_deposit_pct, v_currency
      from public.properties where id = p_property;
    update public.reservations
       set total_amount   = v_total,
           list_amount    = v_total,
           deposit_amount = case when coalesce(v_deposit_pct,0) > 0
                                 then round(v_total * v_deposit_pct / 100) else null end,
           currency       = coalesce(v_currency, currency)
     where id = v_res.id
     returning * into v_res;
  end if;

  return v_res;
end; $$;

-- ---------- 5) Alta manual con precio especial opcional ----------
-- Se agregan dos parámetros al final, con valor por defecto: las llamadas de
-- siempre (11 argumentos) siguen funcionando.
drop function if exists public.create_manual_reservation(
  uuid, uuid, uuid, text, text, text, date, date, int, reservation_status, text);

create function public.create_manual_reservation(
  p_org uuid, p_property uuid, p_unit uuid,
  p_full_name text, p_email text, p_phone text,
  p_check_in date, p_check_out date, p_guests int,
  p_status reservation_status, p_notes text,
  p_total_override numeric default null,
  p_price_note text default null
) returns public.reservations
language plpgsql security definer set search_path = '' as $$
declare
  v_guest uuid; v_res public.reservations;
  v_note text; v_list numeric; v_pct numeric; v_currency text;
  v_total numeric;
begin
  if not public.is_member_of(p_org) then raise exception 'FORBIDDEN'; end if;
  if p_total_override is not null and not public.is_admin_of(p_org) then
    raise exception 'FORBIDDEN_PRICE';
  end if;

  v_note := public._checked_price_note(
    case when p_total_override is null then null else round(p_total_override, 2) end,
    p_price_note);

  v_guest := public._upsert_guest(p_org, p_full_name, p_email, p_phone);
  v_res := public._book(p_org, p_property, p_unit, v_guest,
                        p_check_in, p_check_out, p_guests,
                        coalesce(p_status,'confirmed'), 'manual', auth.uid(), null);

  if nullif(trim(p_notes), '') is not null then
    update public.reservations set notes = p_notes where id = v_res.id returning * into v_res;
  end if;

  if p_total_override is not null then
    v_total := round(p_total_override, 2);
    v_list  := v_res.list_amount;
    select deposit_pct, currency into v_pct, v_currency
      from public.properties where id = p_property;

    update public.reservations
       set total_amount        = v_total,
           list_amount         = coalesce(v_list, total_amount),
           deposit_amount      = case when v_total = 0 then 0
                                      when coalesce(v_pct, 0) > 0 then round(v_total * v_pct / 100)
                                      else null end,
           price_override      = true,
           price_override_note = v_note,
           currency            = coalesce(v_currency, currency)
     where id = v_res.id
     returning * into v_res;

    perform app_private.audit_reservation(
      p_org, v_res.id, v_res.code, 'priced',
      jsonb_build_object(
        'from_total', v_list,
        'to_total', v_res.total_amount,
        'list_amount', v_res.list_amount,
        'note', v_res.price_override_note,
        'override', true,
        'created', true));
  end if;

  return v_res;
end; $$;

revoke execute on function public.create_manual_reservation(
  uuid, uuid, uuid, text, text, text, date, date, int, reservation_status, text, numeric, text)
  from public, anon;
grant execute on function public.create_manual_reservation(
  uuid, uuid, uuid, text, text, text, date, date, int, reservation_status, text, numeric, text)
  to authenticated, service_role;

-- ---------- 6) Editar una reserva con precio especial ----------
-- Tres parámetros nuevos al final:
--   p_total_override  el total especial deseado (null = no tocar / volver al sistema si p_clear_override)
--   p_price_note      motivo
--   p_clear_override  quitar el precio especial y volver al precio de las tarifas
--
-- Semántica sin parámetros (la app vieja): si la reserva ya tenía precio
-- especial, se conserva; si no, se recalcula como siempre al cambiar fechas.
drop function if exists public.update_reservation(
  uuid, uuid, date, date, int, text, text, text, text);

create function public.update_reservation(
  p_reservation uuid,
  p_unit        uuid,
  p_check_in    date,
  p_check_out   date,
  p_guests      int,
  p_full_name   text,
  p_email       text,
  p_phone       text,
  p_notes       text,
  p_total_override numeric default null,
  p_price_note     text default null,
  p_clear_override boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.reservations;
  v     public.reservations;
  v_unit public.units;
  v_guest public.guests;
  v_old_unit_name text;
  v_name  text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_stay_changed  boolean;
  v_guest_changed boolean;
  v_notes_changed boolean;
  v_price_changed boolean := false;
  v_had_override  boolean;
  v_override numeric;
  v_note     text;
  v_quote    numeric;
  v_list     numeric;
  v_min int;
  v_total numeric;
  v_deposit numeric;
  v_pct numeric;
  v_currency text;
  v_no_price boolean := false;
  v_new_guest uuid;
  v_others int;
  v_paid numeric;
  v_changes jsonb := '{}'::jsonb;
begin
  -- Candado de la fila: dos ediciones de la misma reserva se hacen una detrás
  -- de la otra. Entre reservas distintas, lo que impide quedar en las mismas
  -- fechas es la restricción EXCLUDE de unit_occupancy.
  select * into v_old from public.reservations where id = p_reservation for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.is_member_of(v_old.organization_id) then raise exception 'FORBIDDEN'; end if;
  if v_old.status in ('cancelled', 'expired') then raise exception 'NOT_EDITABLE'; end if;

  if v_name is null then raise exception 'NAME_REQUIRED'; end if;
  if p_guests is null or p_guests < 1 then raise exception 'INVALID_GUESTS'; end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    raise exception 'INVALID_DATES';
  end if;

  -- La unidad tiene que ser de este complejo; una inactiva solo sirve si la
  -- reserva ya estaba en ella (para poder corregir datos del huésped).
  select * into v_unit from public.units
   where id = p_unit and organization_id = v_old.organization_id
     and (is_active or id = v_old.unit_id);
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;

  v_stay_changed := (p_unit, p_check_in, p_check_out, p_guests)
                    is distinct from (v_old.unit_id, v_old.check_in, v_old.check_out, v_old.guests_count);

  if v_stay_changed then
    if p_guests > v_unit.capacity then raise exception 'OVER_CAPACITY'; end if;
    v_min := public._min_nights_required(p_unit, p_check_in, p_check_out, p_guests);
    if (p_check_out - p_check_in) < v_min then raise exception 'MIN_NIGHTS:%', v_min; end if;
  end if;

  -- ---------- Precio especial ----------
  -- Fijar, cambiar o quitar un precio es decisión de dueño/administrador.
  if (p_total_override is not null or p_clear_override) and not public.is_admin_of(v_old.organization_id) then
    raise exception 'FORBIDDEN_PRICE';
  end if;

  v_had_override := coalesce(v_old.price_override, false);

  if p_clear_override then
    v_override := null;
    v_note := null;
    v_price_changed := v_had_override;
  elsif p_total_override is not null then
    v_override := round(p_total_override, 2);
    v_note := public._checked_price_note(v_override, p_price_note);
    v_price_changed := not v_had_override
                       or v_override is distinct from v_old.total_amount
                       or v_note is distinct from v_old.price_override_note;
  else
    -- Sin parámetros: si ya había precio especial, se conserva.
    v_override := case when v_had_override then v_old.total_amount else null end;
    v_note := v_old.price_override_note;
  end if;

  select * into v_guest from public.guests where id = v_old.guest_id;
  v_guest_changed := v_guest.id is null
    or (v_name, v_email, v_phone) is distinct from (
         btrim(v_guest.full_name),
         nullif(lower(btrim(coalesce(v_guest.email, ''))), ''),
         nullif(btrim(coalesce(v_guest.phone, '')), ''));
  v_notes_changed := v_notes is distinct from nullif(btrim(coalesce(v_old.notes, '')), '');

  if not (v_stay_changed or v_guest_changed or v_notes_changed or v_price_changed) then
    select coalesce(sum(amount), 0) into v_paid
      from public.payments where reservation_id = v_old.id and status = 'paid';
    return jsonb_build_object(
      'changed', false, 'id', v_old.id, 'code', v_old.code, 'unit_name', v_unit.name,
      'total_amount', v_old.total_amount, 'deposit_amount', v_old.deposit_amount,
      'list_amount', v_old.list_amount, 'price_override', v_old.price_override,
      'price_override_note', v_old.price_override_note,
      'currency', v_old.currency, 'paid_amount', v_paid,
      'balance', case when v_old.total_amount is null then null else v_old.total_amount - v_paid end,
      'no_price', false);
  end if;

  -- Las fechas: se mueve la ocupación junto con la reserva, en esta misma
  -- transacción. Si otra reserva, un bloqueo o una fecha importada de
  -- Booking/Airbnb ya las ocupa, la restricción lo rechaza y no cambia nada.
  if v_stay_changed and public.holds_inventory(v_old.status) then
    begin
      update public.unit_occupancy
         set unit_id = p_unit, during = daterange(p_check_in, p_check_out, '[)')
       where reservation_id = v_old.id;
      if not found then
        insert into public.unit_occupancy
          (organization_id, unit_id, during, kind, reservation_id, created_by)
        values (v_old.organization_id, p_unit, daterange(p_check_in, p_check_out, '[)'),
                'reservation', v_old.id, auth.uid());
      end if;
    exception when exclusion_violation then
      raise exception 'UNAVAILABLE';
    end;
  end if;

  -- Precio: el de lista siempre sale de la misma función que usa _book.
  -- El especial, si existe, manda sobre el total.
  if v_stay_changed or v_price_changed or v_had_override then
    v_quote := public._unit_stay_price(p_unit, p_check_in, p_check_out, p_guests);
  else
    v_quote := coalesce(v_old.list_amount, v_old.total_amount);
  end if;

  if v_override is not null then
    v_total := v_override;
    v_list  := v_quote;
    if v_price_changed or v_old.deposit_amount is null then
      select deposit_pct, currency into v_pct, v_currency
        from public.properties where id = v_unit.property_id;
      v_deposit := case when v_total = 0 then 0
                        when coalesce(v_pct, 0) > 0 then round(v_total * v_pct / 100)
                        else null end;
    else
      v_deposit := v_old.deposit_amount;
      v_currency := v_old.currency;
    end if;
  elsif v_stay_changed or v_price_changed then
    v_total := v_quote;
    v_list  := v_quote;
    select deposit_pct, currency into v_pct, v_currency
      from public.properties where id = v_unit.property_id;
    if v_total is null then
      v_no_price := true;
      v_deposit := null;
    else
      v_deposit := case when coalesce(v_pct, 0) > 0 then round(v_total * v_pct / 100) else null end;
    end if;
  else
    v_total := v_old.total_amount;
    v_deposit := v_old.deposit_amount;
    v_list := coalesce(v_old.list_amount, v_old.total_amount);
    v_currency := v_old.currency;
  end if;

  -- El huésped: si es una persona que solo tiene esta reserva, se corrige su
  -- ficha; si tiene otras (o el mail ya es de otra ficha), se vincula la
  -- reserva a la ficha que corresponde sin tocar el historial de las demás.
  v_new_guest := v_old.guest_id;
  if v_guest_changed then
    select count(*) into v_others
      from public.reservations where guest_id = v_old.guest_id and id <> v_old.id;
    if v_guest.id is not null and v_others = 0 then
      begin
        update public.guests set full_name = v_name, email = v_email, phone = v_phone
         where id = v_old.guest_id;
      exception when unique_violation then
        v_new_guest := public._upsert_guest(v_old.organization_id, v_name, v_email, v_phone);
      end;
    else
      v_new_guest := public._upsert_guest(v_old.organization_id, v_name, v_email, v_phone);
    end if;
  end if;

  update public.reservations
     set unit_id = p_unit,
         property_id = v_unit.property_id,
         check_in = p_check_in,
         check_out = p_check_out,
         guests_count = p_guests,
         guest_id = v_new_guest,
         notes = v_notes,
         total_amount = v_total,
         list_amount = v_list,
         deposit_amount = v_deposit,
         price_override = (v_override is not null),
         price_override_note = case when v_override is not null then v_note else null end,
         currency = coalesce(v_currency, currency)
   where id = v_old.id
   returning * into v;

  -- Si la ficha vieja quedó sin reservas, no se deja un huésped huérfano.
  if v_new_guest is distinct from v_old.guest_id then
    delete from public.guests g
     where g.id = v_old.guest_id
       and not exists (select 1 from public.reservations r where r.guest_id = g.id);
  end if;

  -- Avisos todavía sin enviar: que salgan con los datos nuevos.
  update public.notification_outbox
     set payload = payload || jsonb_build_object(
           'unit_name', v_unit.name, 'check_in', v.check_in, 'check_out', v.check_out,
           'guests_count', v.guests_count, 'guest_name', v_name,
           'total_amount', v.total_amount, 'deposit_amount', v.deposit_amount,
           'currency', v.currency),
         recipient_email = case when event_type = 'reservation_status_guest' and v_guest_changed
                                then v_email else recipient_email end,
         delivery_status = case when event_type = 'reservation_status_guest' and v_guest_changed
                                     and v_email is null then 'skipped' else delivery_status end,
         next_attempt_at = case when event_type = 'reservation_status_guest' and v_guest_changed
                                     and v_email is null then null else next_attempt_at end,
         last_error = case when event_type = 'reservation_status_guest' and v_guest_changed
                                and v_email is null then 'GUEST_EMAIL_NOT_CONFIGURED' else last_error end
   where reservation_id = v.id and delivery_status = 'pending';

  -- Registro de qué cambió.
  select name into v_old_unit_name from public.units where id = v_old.unit_id;
  if v_old.unit_id is distinct from v.unit_id then
    v_changes := v_changes || jsonb_build_object('unit', jsonb_build_object('from', v_old_unit_name, 'to', v_unit.name));
  end if;
  if v_old.check_in is distinct from v.check_in then
    v_changes := v_changes || jsonb_build_object('check_in', jsonb_build_object('from', v_old.check_in, 'to', v.check_in));
  end if;
  if v_old.check_out is distinct from v.check_out then
    v_changes := v_changes || jsonb_build_object('check_out', jsonb_build_object('from', v_old.check_out, 'to', v.check_out));
  end if;
  if v_old.guests_count is distinct from v.guests_count then
    v_changes := v_changes || jsonb_build_object('guests', jsonb_build_object('from', v_old.guests_count, 'to', v.guests_count));
  end if;
  -- El total por cambio de fechas se registra como edición; el precio
  -- especial tiene su propia entrada 'priced'.
  if v_old.total_amount is distinct from v.total_amount and not v_price_changed then
    v_changes := v_changes || jsonb_build_object('total', jsonb_build_object('from', v_old.total_amount, 'to', v.total_amount));
  end if;
  if v_guest_changed then
    v_changes := v_changes || jsonb_build_object('guest', jsonb_build_object('from', v_guest.full_name, 'to', v_name));
  end if;
  if v_notes_changed then
    v_changes := v_changes || jsonb_build_object('notes', true);
  end if;

  if v_changes <> '{}'::jsonb then
    perform app_private.audit_reservation(v.organization_id, v.id, v.code, 'updated', v_changes);
  end if;

  if v_price_changed then
    perform app_private.audit_reservation(
      v.organization_id, v.id, v.code, 'priced',
      jsonb_build_object(
        'from_total', v_old.total_amount,
        'to_total', v.total_amount,
        'list_amount', v.list_amount,
        'note', v.price_override_note,
        'override', v.price_override,
        'created', false));
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from public.payments where reservation_id = v.id and status = 'paid';

  return jsonb_build_object(
    'changed', true, 'id', v.id, 'code', v.code, 'unit_name', v_unit.name,
    'total_amount', v.total_amount, 'deposit_amount', v.deposit_amount,
    'list_amount', v.list_amount, 'price_override', v.price_override,
    'price_override_note', v.price_override_note,
    'currency', v.currency, 'paid_amount', v_paid,
    'balance', case when v.total_amount is null then null else v.total_amount - v_paid end,
    'no_price', v_no_price);
end; $$;

revoke execute on function public.update_reservation(
  uuid, uuid, date, date, int, text, text, text, text, numeric, text, boolean)
  from public, anon;
grant execute on function public.update_reservation(
  uuid, uuid, date, date, int, text, text, text, text, numeric, text, boolean)
  to authenticated, service_role;
