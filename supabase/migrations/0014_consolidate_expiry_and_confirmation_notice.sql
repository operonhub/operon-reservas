-- ============================================================
-- Operon Reservas — Consolidación: expiración + aviso de seña cobrada
-- ============================================================
-- Al analizar el proyecto antes de tocar nada (como corresponde) aparecieron
-- objetos ya viventes en la base de datos real que NO estaban en ninguna
-- migración versionada — alguien los aplicó directo con execute_sql en un
-- trabajo previo y quedaron sin documentar:
--   * expire_stale_holds(p_limit)      — motor de expiración (mejor que el
--     que yo había escrito en 0012/0013: con batching). Estaba "dormido"
--     porque el enum no tenía el valor 'expired' hasta la migración 0011.
--   * cron job 'expire-stale-holds'    — ya programado cada 5'.
--   * _resolve_admin_email()           — resuelve el email del propietario
--     a notificar (extraído de la lógica que antes vivía inline en 0006).
--   * enqueue_reservation_notification() — versión ampliada: agrega
--     guest_name al payload y un evento nuevo 'reservation_confirmed_admin'
--     ("se cobró la seña") cuando pending/pending_payment → confirmed.
--   * notification_outbox_event_type_check — ampliado para admitir ese
--     evento nuevo.
--
-- Esta migración:
--   1) Deja sin efecto mi expire_stale_reservations()/cron (0012/0013):
--      duplicaban exactamente lo mismo que expire_stale_holds().
--   2) Formaliza (create or replace / idempotente) los objetos de arriba,
--      para que el historial de migraciones vuelva a ser la fuente de
--      verdad real de lo que corre en producción.
-- ============================================================

-- ---------- 1) Baja de mi duplicado ----------
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'expire-stale-reservations';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end $$;

drop function if exists expire_stale_reservations();

-- ---------- 2) Formalización de lo que ya vivía sólo en la base ----------

-- Motor de expiración canónico (con batching; reemplaza al mío).
create or replace function expire_stale_holds(p_limit integer default 200)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_expired int := 0;
begin
  with expired as (
    select r.id
    from public.reservations r
    where r.hold_expires_at is not null
      and r.hold_expires_at <= now()
      and r.status in ('pending', 'pending_payment')
    order by r.hold_expires_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ),
  -- CTE modificadora: se ejecuta aunque no se la referencie después.
  -- Libera la fecha en la única fuente de verdad de disponibilidad.
  released as (
    delete from public.unit_occupancy o
    using expired e
    where o.reservation_id = e.id
    returning o.reservation_id
  )
  update public.reservations r
     set status = 'expired',
         hold_expires_at = null
    from expired e
   where r.id = e.id;

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

revoke execute on function expire_stale_holds(integer) from public, anon, authenticated;
grant execute on function expire_stale_holds(integer) to service_role;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'expire-stale-holds';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'expire-stale-holds',
    '*/5 * * * *',
    'select public.expire_stale_holds();'
  );
end $$;

-- Resuelve a quién avisarle en la organización (email de la property o,
-- si no está configurado, el primer owner/admin con email).
create or replace function _resolve_admin_email(p_org uuid, p_property_email text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_email text;
begin
  v_email := nullif(trim(coalesce(p_property_email, '')), '');
  if v_email is not null then return v_email; end if;

  select nullif(trim(pr.email), '') into v_email
  from public.memberships m
  join public.profiles pr on pr.id = m.user_id
  where m.organization_id = p_org
    and m.role in ('owner', 'admin')
    and nullif(trim(pr.email), '') is not null
  order by case m.role when 'owner' then 0 else 1 end, m.created_at
  limit 1;

  return v_email;
end;
$$;

revoke execute on function _resolve_admin_email(uuid, text) from public, anon, authenticated;

-- Admite el evento nuevo de "seña cobrada" en la outbox.
alter table notification_outbox drop constraint if exists notification_outbox_event_type_check;
alter table notification_outbox add constraint notification_outbox_event_type_check
  check (event_type in (
    'reservation_created_admin', 'reservation_status_guest', 'reservation_confirmed_admin'
  ));

-- Trigger de notificaciones: + guest_name en el payload y aviso al
-- propietario cuando la seña se acredita y la reserva pasa a confirmed.
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
     and old.status in ('pending', 'pending_payment')
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
