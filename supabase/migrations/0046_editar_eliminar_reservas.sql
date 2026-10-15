-- ============================================================
-- 0046 — Editar, cancelar y eliminar reservas desde el panel
-- ============================================================
-- Hasta acá una reserva en estado final no tenía salida: una prueba o un
-- error en "Completada" seguía bloqueando fechas (calendario y buscador
-- público) y nadie podía anularla, editarla ni borrarla sin tocar la base a
-- mano. `reservations` es de solo lectura para el panel desde la 0013, así que
-- todo pasa por funciones de la base (security definer), nunca por update o
-- delete directo desde el cliente.
--
-- Decisiones de producto (el porqué de cada regla):
--
--  CANCELAR  desde cualquier estado menos cancelled/expired, también desde
--            "Completada". Nunca borra nada: los pagos quedan como están
--            (historial contable) y las fechas se liberan.
--  REABRIR   "Completada" → "Confirmada", para corregir un cierre por error.
--            Sigue ocupando las mismas fechas.
--  EDITAR    unidad, fechas, huéspedes, datos del huésped y notas, en
--            cualquier estado menos cancelled/expired. Recalcula total y seña
--            con la misma función de tarifas que usa _book. No toca los pagos:
--            devuelve el saldo nuevo (puede ser negativo: se cobró de más).
--            Cualquier miembro puede editar (igual que crear o cancelar).
--  ELIMINAR  solo dueño o administrador. Solo si NO hubo plata: ningún pago
--            acreditado ni reintegrado (si lo hubo, se cancela y queda el
--            historial) ni un link de pago de Mercado Pago abierto (si el
--            huésped pagara después, el cobro entraría sin reserva). Borra en
--            la misma transacción la ocupación, los pagos pendientes y los
--            avisos, y deja registro de quién borró qué.
--  AVISOS    cancelar avisa por mail al huésped como hasta ahora, salvo que se
--            pida no avisar; reabrir y cancelar desde "Completada" no avisan
--            (son correcciones internas). Editar no manda mails: se le avisa
--            al huésped a mano. Eliminar no avisa y borra los pendientes.
--
-- Además arregla el registro de ingreso/salida: hacía un update directo sobre
-- `reservations` que la política de solo lectura descartaba sin dar error.
-- ============================================================

-- ---------- 1) Registro de lo que se cambia y se borra ----------
-- Sin FK a reservations: tiene que sobrevivir a la eliminación.
create table app_private.reservation_audit (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  reservation_id   uuid not null,
  reservation_code text not null,
  actor_id         uuid,   -- null cuando lo hace el sistema (service_role)
  action           text not null check (action in ('updated', 'cancelled', 'reopened', 'deleted')),
  detail           jsonb not null default '{}'::jsonb
);
create index reservation_audit_org_idx on app_private.reservation_audit (organization_id, at desc);
create index reservation_audit_res_idx on app_private.reservation_audit (reservation_id, at desc);
alter table app_private.reservation_audit enable row level security;
revoke all on app_private.reservation_audit from public, anon, authenticated;

create function app_private.audit_reservation(
  p_org uuid, p_reservation uuid, p_code text, p_action text, p_detail jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into app_private.reservation_audit
    (organization_id, reservation_id, reservation_code, actor_id, action, detail)
  values (p_org, p_reservation, p_code, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function app_private.audit_reservation(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Lo lee solo el dueño o un administrador de ese complejo.
create function public.reservation_audit_log(
  p_org uuid, p_reservation uuid default null, p_limit int default 100
) returns table (
  at               timestamptz,
  action           text,
  reservation_id   uuid,
  reservation_code text,
  actor_name       text,
  detail           jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin_of(p_org) then raise exception 'FORBIDDEN'; end if;

  return query
  select a.at, a.action, a.reservation_id, a.reservation_code,
         coalesce(nullif(btrim(p.full_name), ''), 'El sistema'), a.detail
    from app_private.reservation_audit a
    left join public.profiles p on p.id = a.actor_id
   where a.organization_id = p_org
     and (p_reservation is null or a.reservation_id = p_reservation)
   order by a.at desc, a.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end; $$;
revoke execute on function public.reservation_audit_log(uuid, uuid, int) from public, anon;
grant execute on function public.reservation_audit_log(uuid, uuid, int) to authenticated;

-- ---------- 2) Máquina de estados ----------
-- Se suma: completed → confirmed (reabrir) y completed → cancelled.
-- Igual que antes, el panel nunca ofrece 'expired' como destino
-- (lib/constants.ts); desde cancelled y expired no se sale.
create or replace function public._can_transition(p_from reservation_status, p_to reservation_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'inquiry'         then p_to in ('pending','pending_payment','cancelled')
    when 'pending'         then p_to in ('pending_payment','confirmed','cancelled','expired')
    when 'pending_payment' then p_to in ('confirmed','cancelled','expired')
    when 'confirmed'       then p_to in ('completed','cancelled')
    when 'completed'       then p_to in ('confirmed','cancelled')
    else false
  end;
$$;

-- ---------- 3) Avisos al huésped ----------
-- Misma función que producción, con una sola diferencia: el mail al huésped
-- por cambio de estado queda "skipped" (sin enviar, con el motivo) cuando
-- quien lo cambia pidió no avisar, o cuando el estado anterior era
-- "Completada" (reabrir o cancelar ahí es corregir un cierre, no una novedad
-- para el huésped).
create or replace function public.enqueue_reservation_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_property_name text;
  v_property_email text;
  v_unit_name text;
  v_guest_email text;
  v_guest_name text;
  v_admin_email text;
  v_payload jsonb;
  v_silent boolean;
begin
  select o.name, p.name, nullif(trim(p.email), ''), u.name,
         nullif(trim(g.email), ''), nullif(trim(g.full_name), '')
    into v_org_name, v_property_name, v_property_email, v_unit_name,
         v_guest_email, v_guest_name
  from public.organizations o
  join public.properties p on p.id = new.property_id
  join public.units u on u.id = new.unit_id
  left join public.guests g on g.id = new.guest_id
  where o.id = new.organization_id;

  v_payload := jsonb_build_object(
    'reservation_id', new.id,
    'reservation_code', new.code,
    'organization_name', v_org_name,
    'property_name', v_property_name,
    'property_email', v_property_email,
    'unit_name', v_unit_name,
    'guest_name', v_guest_name,
    'check_in', new.check_in,
    'check_out', new.check_out,
    'guests_count', new.guests_count,
    'total_amount', new.total_amount,
    'deposit_amount', new.deposit_amount,
    'currency', new.currency,
    'source', new.source
  );

  if tg_op = 'INSERT' then
    -- Una carga manual ya es conocida por el admin que la creó.
    if new.source <> 'manual' then
      v_admin_email := public._resolve_admin_email(new.organization_id, v_property_email);

      insert into public.notification_outbox (
        organization_id, reservation_id, event_type, reservation_status,
        recipient_email, idempotency_key, payload, delivery_status,
        next_attempt_at, last_error
      ) values (
        new.organization_id, new.id, 'reservation_created_admin', new.status,
        v_admin_email, 'reservation-created-admin:' || new.id,
        v_payload || jsonb_build_object('new_status', new.status),
        case when v_admin_email is null then 'skipped' else 'pending' end,
        case when v_admin_email is null then null else now() end,
        case when v_admin_email is null then 'ADMIN_EMAIL_NOT_CONFIGURED' else null end
      ) on conflict (idempotency_key) do nothing;
    end if;

    return new;
  end if;

  if old.status is distinct from new.status then
    v_silent := coalesce(current_setting('operon.skip_guest_email', true), '') = '1'
                or old.status = 'completed';

    insert into public.notification_outbox (
      organization_id, reservation_id, event_type, reservation_status,
      recipient_email, idempotency_key, payload, delivery_status,
      next_attempt_at, last_error
    ) values (
      new.organization_id, new.id, 'reservation_status_guest', new.status,
      v_guest_email,
      'reservation-status-guest:' || new.id || ':' || old.status || ':' || new.status,
      v_payload || jsonb_build_object('old_status', old.status, 'new_status', new.status),
      case when v_silent or v_guest_email is null then 'skipped' else 'pending' end,
      case when v_silent or v_guest_email is null then null else now() end,
      case when v_silent then 'NOT_NOTIFIED_BY_CHOICE'
           when v_guest_email is null then 'GUEST_EMAIL_NOT_CONFIGURED'
           else null end
    ) on conflict (idempotency_key) do nothing;
  end if;

  -- Confirmación automática vía pago (pending/pending_payment → confirmed):
  -- el aviso que de verdad le importa al propietario ("se cobró la seña").
  if old.status is distinct from new.status
     and old.status in ('pending', 'pending_payment', 'expired')
     and new.status = 'confirmed' then
    v_admin_email := public._resolve_admin_email(new.organization_id, v_property_email);

    insert into public.notification_outbox (
      organization_id, reservation_id, event_type, reservation_status,
      recipient_email, idempotency_key, payload, delivery_status,
      next_attempt_at, last_error
    ) values (
      new.organization_id, new.id, 'reservation_confirmed_admin', new.status,
      v_admin_email,
      'reservation-confirmed-admin:' || new.id,
      v_payload || jsonb_build_object('old_status', old.status, 'new_status', new.status),
      case when v_admin_email is null then 'skipped' else 'pending' end,
      case when v_admin_email is null then null else now() end,
      case when v_admin_email is null then 'ADMIN_EMAIL_NOT_CONFIGURED' else null end
    ) on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

-- ---------- 4) Cambiar de estado (con registro y con opción de no avisar) ----------
-- Se agrega p_notify con valor por defecto: quien llama con (reserva, estado)
-- —la app anterior, el webhook de Mercado Pago, el checkout— sigue andando igual.
drop function if exists public.transition_reservation(uuid, reservation_status);

create function public.transition_reservation(
  p_reservation uuid, p_to reservation_status, p_notify boolean default true
) returns reservation_status
language plpgsql security definer set search_path = '' as $$
declare
  v public.reservations;
  v_paid numeric;
  v_notify boolean := coalesce(p_notify, true);
begin
  select * into v from public.reservations where id = p_reservation for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.is_member_of(v.organization_id) or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN';
  end if;
  if not public._can_transition(v.status, p_to) then raise exception 'INVALID_TRANSITION'; end if;

  if public.holds_inventory(p_to) and not public.holds_inventory(v.status) then
    begin
      insert into public.unit_occupancy
        (organization_id, unit_id, during, kind, reservation_id, created_by)
      values (v.organization_id, v.unit_id, daterange(v.check_in, v.check_out, '[)'),
              'reservation', v.id, auth.uid());
    exception when exclusion_violation then raise exception 'UNAVAILABLE'; end;
  elsif public.holds_inventory(v.status) and not public.holds_inventory(p_to) then
    delete from public.unit_occupancy where reservation_id = v.id;
  end if;

  -- Solo vale dentro de esta transacción: lo lee el trigger de avisos.
  if not v_notify then perform set_config('operon.skip_guest_email', '1', true); end if;

  update public.reservations
     set status = p_to,
         hold_expires_at = case when p_to in ('confirmed','completed') then null else hold_expires_at end
   where id = v.id;

  perform set_config('operon.skip_guest_email', '', true);

  if p_to = 'cancelled' or (v.status = 'completed' and p_to = 'confirmed') then
    select coalesce(sum(amount), 0) into v_paid
      from public.payments where reservation_id = v.id and status = 'paid';
    perform app_private.audit_reservation(
      v.organization_id, v.id, v.code,
      case when p_to = 'cancelled' then 'cancelled' else 'reopened' end,
      jsonb_build_object('from', v.status, 'to', p_to, 'paid_amount', v_paid,
                         'guest_notified', v_notify and v.status <> 'completed'));
  end if;

  return p_to;
end; $$;
revoke execute on function public.transition_reservation(uuid, reservation_status, boolean) from public, anon;
grant execute on function public.transition_reservation(uuid, reservation_status, boolean) to authenticated, service_role;

-- ---------- 5) Editar una reserva ----------
create function public.update_reservation(
  p_reservation uuid,
  p_unit        uuid,
  p_check_in    date,
  p_check_out   date,
  p_guests      int,
  p_full_name   text,
  p_email       text,
  p_phone       text,
  p_notes       text
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

  select * into v_guest from public.guests where id = v_old.guest_id;
  v_guest_changed := v_guest.id is null
    or (v_name, v_email, v_phone) is distinct from (
         btrim(v_guest.full_name),
         nullif(lower(btrim(coalesce(v_guest.email, ''))), ''),
         nullif(btrim(coalesce(v_guest.phone, '')), ''));
  v_notes_changed := v_notes is distinct from nullif(btrim(coalesce(v_old.notes, '')), '');

  if not (v_stay_changed or v_guest_changed or v_notes_changed) then
    select coalesce(sum(amount), 0) into v_paid
      from public.payments where reservation_id = v_old.id and status = 'paid';
    return jsonb_build_object(
      'changed', false, 'id', v_old.id, 'code', v_old.code, 'unit_name', v_unit.name,
      'total_amount', v_old.total_amount, 'deposit_amount', v_old.deposit_amount,
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

  -- Precio: la misma función que usa _book. Sin tarifa para esas noches, el
  -- total queda vacío (como una reserva nueva sin tarifa) y se avisa.
  if v_stay_changed then
    v_total := public._unit_stay_price(p_unit, p_check_in, p_check_out, p_guests);
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
         deposit_amount = v_deposit,
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
  if v_old.total_amount is distinct from v.total_amount then
    v_changes := v_changes || jsonb_build_object('total', jsonb_build_object('from', v_old.total_amount, 'to', v.total_amount));
  end if;
  if v_guest_changed then
    v_changes := v_changes || jsonb_build_object('guest', jsonb_build_object('from', v_guest.full_name, 'to', v_name));
  end if;
  if v_notes_changed then
    v_changes := v_changes || jsonb_build_object('notes', true);
  end if;
  perform app_private.audit_reservation(v.organization_id, v.id, v.code, 'updated', v_changes);

  select coalesce(sum(amount), 0) into v_paid
    from public.payments where reservation_id = v.id and status = 'paid';

  return jsonb_build_object(
    'changed', true, 'id', v.id, 'code', v.code, 'unit_name', v_unit.name,
    'total_amount', v.total_amount, 'deposit_amount', v.deposit_amount,
    'currency', v.currency, 'paid_amount', v_paid,
    'balance', case when v.total_amount is null then null else v.total_amount - v_paid end,
    'no_price', v_no_price);
end; $$;
revoke execute on function public.update_reservation(uuid, uuid, date, date, int, text, text, text, text) from public, anon;
grant execute on function public.update_reservation(uuid, uuid, date, date, int, text, text, text, text) to authenticated;

-- ---------- 6) Eliminar una reserva ----------
create function public.delete_reservation(p_reservation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.reservations;
  v_unit_name text;
  v_guest_name text;
  v_pending int;
  v_notices int;
begin
  select * into v from public.reservations where id = p_reservation for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.is_admin_of(v.organization_id) then raise exception 'FORBIDDEN'; end if;

  -- Con plata de por medio no se borra: se cancela y queda el historial.
  if exists (select 1 from public.payments
              where reservation_id = v.id and status in ('paid', 'refunded')) then
    raise exception 'HAS_PAYMENTS';
  end if;
  -- Un link de pago abierto todavía se puede pagar: si borráramos la reserva,
  -- ese cobro entraría a la cuenta sin reserva que lo explique.
  if exists (select 1 from public.payments
              where reservation_id = v.id and status = 'pending' and mp_init_point is not null) then
    raise exception 'HAS_OPEN_CHECKOUT';
  end if;

  select u.name into v_unit_name from public.units u where u.id = v.unit_id;
  select g.full_name into v_guest_name from public.guests g where g.id = v.guest_id;
  select count(*) into v_pending from public.payments where reservation_id = v.id;
  select count(*) into v_notices from public.notification_outbox where reservation_id = v.id;

  perform app_private.audit_reservation(
    v.organization_id, v.id, v.code, 'deleted',
    jsonb_build_object(
      'status', v.status, 'source', v.source, 'unit', v_unit_name, 'guest', v_guest_name,
      'check_in', v.check_in, 'check_out', v.check_out, 'guests', v.guests_count,
      'total', v.total_amount, 'currency', v.currency,
      'payments_removed', v_pending, 'notices_removed', v_notices));

  -- La ocupación, los pagos pendientes y los avisos se van con la reserva
  -- (on delete cascade); las alertas de iCal que la nombraban quedan sin ella.
  delete from public.reservations where id = v.id;

  delete from public.guests g
   where g.id = v.guest_id
     and not exists (select 1 from public.reservations r where r.guest_id = g.id);

  return jsonb_build_object('deleted', true, 'code', v.code);
end; $$;
revoke execute on function public.delete_reservation(uuid) from public, anon;
grant execute on function public.delete_reservation(uuid) to authenticated;

-- ---------- 7) Registrar ingreso o salida ----------
-- El panel lo hacía con un update directo que la política de solo lectura de
-- `reservations` (0013) descartaba sin error: parecía guardar y no guardaba.
create function public.record_reservation_movement(p_reservation uuid, p_movement text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v public.reservations;
  v_at timestamptz := now();
begin
  if p_movement not in ('checkin', 'checkout') then raise exception 'INVALID_MOVEMENT'; end if;

  select * into v from public.reservations where id = p_reservation for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.is_member_of(v.organization_id) then raise exception 'FORBIDDEN'; end if;
  if v.status in ('cancelled', 'expired') then raise exception 'NOT_EDITABLE'; end if;

  if p_movement = 'checkin' then
    if v.checked_in_at is not null then raise exception 'ALREADY_RECORDED'; end if;
    update public.reservations set checked_in_at = v_at where id = v.id;
  else
    if v.checked_out_at is not null then raise exception 'ALREADY_RECORDED'; end if;
    update public.reservations set checked_out_at = v_at where id = v.id;
  end if;

  return v_at;
end; $$;
revoke execute on function public.record_reservation_movement(uuid, text) from public, anon;
grant execute on function public.record_reservation_movement(uuid, text) to authenticated;
