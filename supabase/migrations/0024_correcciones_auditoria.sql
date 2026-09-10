-- ============================================================
-- Operon Reservas — Correcciones de la auditoría técnica (2026-09-10)
-- ============================================================
-- Ver auditoria-2026-09/AUDITORIA_TECNICA.md. Cada sección cita el
-- hallazgo que corrige.
--
-- COMPATIBLE HACIA ATRÁS con el código hoy deployado: se puede aplicar
-- antes o después de mergear la rama, en cualquier orden. Ninguna firma
-- que el front usa cambia de forma incompatible y ninguna escritura que
-- la app hace hoy queda bloqueada.
-- ============================================================


-- ------------------------------------------------------------
-- A-01 · El sync de iCal no borra todo ante un feed vacío
-- ------------------------------------------------------------
-- Si Airbnb/Booking responden 200 con algo que no es iCal (link caducado,
-- login, captcha), el parser del worker devuelve [] y el borrado de "lo que
-- ya no está en el feed" se llevaba TODOS los bloqueos importados. La fecha
-- volvía a la venta: el overbooking que esta feature existe para evitar.
--
-- Ahora un feed vacío NO borra nada, salvo que el worker confirme con
-- p_allow_empty = true que leyó un VCALENDAR válido y sin eventos (el caso
-- legítimo: se cancelaron todas las reservas en la plataforma).
--
-- El parámetro nuevo tiene default, así que el worker viejo (4 argumentos)
-- sigue funcionando y queda protegido sin redeployarlo.
drop function if exists sync_unit_external_blocks(text, uuid, text, jsonb);

create or replace function sync_unit_external_blocks(
  p_worker_token text,
  p_unit_id uuid,
  p_source text,
  p_ranges jsonb,
  p_allow_empty boolean default false
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_uids text[];
  v_inserted int := 0;
  v_updated int := 0;
  v_removed int := 0;
  v_skipped int := 0;
  v_was_insert boolean;
  v_empty_guard boolean := false;
  r record;
begin
  if not public.is_ical_sync_worker(p_worker_token) then
    raise exception 'FORBIDDEN';
  end if;

  if p_source not in ('airbnb', 'booking') then
    raise exception 'INVALID_SOURCE';
  end if;

  select organization_id into v_org from public.units where id = p_unit_id;
  if v_org is null then raise exception 'UNIT_NOT_FOUND'; end if;

  for r in
    select value->>'uid' as uid,
           nullif(value->>'start_date', '')::date as start_date,
           nullif(value->>'end_date', '')::date as end_date
    from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) as value
  loop
    if r.uid is null or r.start_date is null or r.end_date is null
       or r.end_date <= r.start_date then
      continue;
    end if;

    begin
      insert into public.unit_occupancy
        (organization_id, unit_id, during, kind, external_source, external_uid)
      values
        (v_org, p_unit_id, daterange(r.start_date, r.end_date, '[)'),
         'block', p_source, r.uid)
      on conflict (unit_id, external_source, external_uid)
        where external_source is not null
        do update set during = excluded.during
      returning (xmax = 0) into v_was_insert;

      if v_was_insert then
        v_inserted := v_inserted + 1;
      else
        v_updated := v_updated + 1;
      end if;
    exception when exclusion_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  v_uids := array(
    select value->>'uid'
    from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) as value
    where value->>'uid' is not null
  );

  -- Sin ningún uid en el feed, "borrar lo que ya no está" significa borrar
  -- todo. Eso sólo se hace con confirmación explícita del worker.
  if cardinality(v_uids) = 0 and not coalesce(p_allow_empty, false) then
    v_empty_guard := true;
  else
    with removed as (
      delete from public.unit_occupancy
      where unit_id = p_unit_id
        and external_source = p_source
        and not (external_uid = any(v_uids))
      returning 1
    )
    select count(*) into v_removed from removed;
  end if;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'removed', v_removed,
    'skipped_conflicts', v_skipped,
    'empty_feed_ignored', v_empty_guard
  );
end;
$$;

revoke execute on function sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  to service_role;


-- ------------------------------------------------------------
-- M-01 · unit_occupancy deja de aceptar escritura directa
-- ------------------------------------------------------------
-- 0013 cerró reservations/payments a solo lectura porque "todo cambio pasa
-- por RPC". unit_occupancy quedó afuera con su policy "for all" de 0002:
-- cualquier miembro podía borrar por PostgREST la ocupación de una reserva
-- confirmada y la restricción EXCLUDE ya no tenía nada que proteger.
--
-- Lo único que la app escribe directo en esta tabla es deleteBlock
-- (calendario/actions.ts), que borra filas kind = 'block'. Eso sigue
-- permitido tal cual; lo demás pasa por las RPC SECURITY DEFINER de siempre
-- (_book, create_block, transition_reservation, el sync de iCal).
drop policy if exists unit_occupancy_rw on unit_occupancy;

create policy unit_occupancy_select on unit_occupancy
  for select to authenticated
  using ( public.is_member_of(organization_id) );

create policy unit_occupancy_delete_blocks on unit_occupancy
  for delete to authenticated
  using ( public.is_member_of(organization_id) and kind = 'block' );


-- ------------------------------------------------------------
-- M-02 (parcial) · Ningún usuario del panel puede borrar la organización
-- ------------------------------------------------------------
-- organizations es la raíz de todos los ON DELETE CASCADE: borrarla se lleva
-- propiedades, unidades, reservas, huéspedes y pagos. La policy "for all" de
-- 0002 se lo permitía a cualquier miembro, incluido 'staff'. El panel nunca
-- escribe en esta tabla, así que queda en solo lectura; las altas y bajas de
-- organizaciones siguen siendo tarea del service role, como ya decía 0002.
--
-- El resto de la matriz de permisos por rol (qué puede tocar 'staff' en
-- tarifas, unidades y configuración) queda pendiente de definir.
drop policy if exists organizations_rw on organizations;

create policy organizations_select on organizations
  for select to authenticated
  using ( public.is_member_of(id) );


-- ------------------------------------------------------------
-- M-03 · create_public_reservation devuelve lo que el front muestra
-- ------------------------------------------------------------
-- La web pública lee total_amount, deposit_amount, currency y
-- hold_expires_at para la pantalla de confirmación; la RPC devolvía cinco
-- claves y ninguna de esas, así que el huésped nunca veía el precio. Los
-- valores ya estaban calculados en v_res: sólo faltaba devolverlos.
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

  return jsonb_build_object(
    'ok', true,
    'code', v_res.code,
    'status', v_res.status,
    'check_in', v_res.check_in,
    'check_out', v_res.check_out,
    'total_amount', v_res.total_amount,
    'deposit_amount', v_res.deposit_amount,
    'currency', v_res.currency,
    'hold_expires_at', v_res.hold_expires_at
  );
end; $$;


-- ------------------------------------------------------------
-- M-06 · Una sola seña pendiente por reserva
-- ------------------------------------------------------------
-- /api/mp/checkout busca la seña pendiente con maybeSingle(). Dos clicks
-- simultáneos insertaban dos filas; desde ahí maybeSingle() devolvía error
-- en cada llamada (más de una fila), el código lo ignoraba y creaba OTRA
-- seña y OTRA preferencia de Mercado Pago en cada pedido, para siempre.
--
-- Si ya existieran duplicados, se conserva el más reciente (que es el que
-- actualiza el webhook) y los anteriores pasan a 'failed': son preferencias
-- abandonadas que nunca recibieron un pago. En una base sin cobros reales
-- todavía, esto no toca ninguna fila.
update public.payments p
   set status = 'failed', updated_at = now()
 where p.kind = 'deposit'
   and p.status = 'pending'
   and exists (
     select 1 from public.payments newer
      where newer.reservation_id = p.reservation_id
        and newer.kind = 'deposit'
        and newer.status = 'pending'
        and (newer.created_at, newer.id) > (p.created_at, p.id)
   );

create unique index if not exists payments_one_pending_deposit_uidx
  on payments (reservation_id)
  where kind = 'deposit' and status = 'pending';


-- ------------------------------------------------------------
-- A-02 · Un pago que acredita tarde recupera la reserva expirada
-- ------------------------------------------------------------
-- El hold vence a los 15'; el efectivo de Mercado Pago (Rapipago, Pago Fácil)
-- acredita en días. Para entonces expire_stale_holds (0012) ya liberó la
-- fecha y dejó la reserva en 'expired', el webhook sólo confirmaba
-- pending/pending_payment y 'expired' es terminal: el huésped pagaba y se
-- quedaba sin reserva, sin que el panel ofreciera ninguna salida.
--
-- Esta RPC la usa sólo el webhook, y sólo con un pago ya verificado contra la
-- API de MP (monto y moneda). Re-toma la ocupación: si la fecha sigue libre,
-- confirma; si ya se revendió, devuelve UNAVAILABLE y no toca nada.
-- _can_transition NO se modifica: desde el panel 'expired' sigue siendo
-- terminal. El único camino de salida es un pago real.
create or replace function recover_paid_expired_reservation(p_reservation uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v public.reservations;
begin
  select * into v from public.reservations where id = p_reservation for update;
  if not found then return 'NOT_FOUND'; end if;
  if v.status <> 'expired' then return 'NOT_EXPIRED'; end if;

  begin
    insert into public.unit_occupancy
      (organization_id, unit_id, during, kind, reservation_id)
    values
      (v.organization_id, v.unit_id, daterange(v.check_in, v.check_out, '[)'),
       'reservation', v.id);
  exception when exclusion_violation then
    return 'UNAVAILABLE';
  end;

  update public.reservations
     set status = 'confirmed', hold_expires_at = null
   where id = v.id;

  return 'RECOVERED';
end;
$$;

revoke execute on function recover_paid_expired_reservation(uuid) from public, anon, authenticated;
grant execute on function recover_paid_expired_reservation(uuid) to service_role;

-- El aviso "se acreditó la seña y la reserva quedó confirmada" (0014) sólo
-- salía desde pending/pending_payment. Se suma 'expired' para que el
-- propietario se entere también cuando la reserva se recupera por un pago
-- tardío. El resto de la función es idéntico a 0014.
create or replace function enqueue_reservation_notification()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_property_name text;
  v_property_email text;
  v_unit_name text;
  v_guest_email text;
  v_guest_name text;
  v_admin_email text;
  v_payload jsonb;
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
    insert into public.notification_outbox (
      organization_id, reservation_id, event_type, reservation_status,
      recipient_email, idempotency_key, payload, delivery_status,
      next_attempt_at, last_error
    ) values (
      new.organization_id, new.id, 'reservation_status_guest', new.status,
      v_guest_email,
      'reservation-status-guest:' || new.id || ':' || old.status || ':' || new.status,
      v_payload || jsonb_build_object('old_status', old.status, 'new_status', new.status),
      case when v_guest_email is null then 'skipped' else 'pending' end,
      case when v_guest_email is null then null else now() end,
      case when v_guest_email is null then 'GUEST_EMAIL_NOT_CONFIGURED' else null end
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

revoke execute on function enqueue_reservation_notification() from public, anon, authenticated;


-- ------------------------------------------------------------
-- B-02 · El mínimo de noches respeta los días de la semana de la regla
-- ------------------------------------------------------------
-- _unit_rule_for_night filtra por weekdays; _min_nights_required no. Una
-- regla "viernes y sábado, mínimo 2 noches" exigía 2 noches también un lunes,
-- y public_availability ocultaba la unidad entera. Hoy el formulario no crea
-- esa combinación, pero la corrección del motor no puede depender de eso.
-- Ahora la regla cuenta sólo si alguna noche real de la estadía cae en sus días.
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
    and (r.start_date is null or r.start_date < p_check_out)
    and (r.end_date   is null or r.end_date  >= p_check_in)
    and (r.min_guests is null or coalesce(p_guests, 1) >= r.min_guests)
    and (r.max_guests is null or coalesce(p_guests, 1) <= r.max_guests)
    and (r.weekdays is null or exists (
          select 1
          from generate_series(p_check_in, p_check_out - 1, interval '1 day') d
          where extract(dow from d)::smallint = any(r.weekdays)
        ));
$$;

revoke execute on function _min_nights_required(uuid, date, date, int) from public, anon, authenticated;
