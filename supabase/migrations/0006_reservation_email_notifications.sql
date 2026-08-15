-- ============================================================
-- Operon Reservas — notificaciones transaccionales por email
-- ============================================================
-- La base registra eventos en una outbox dentro de la misma transacción
-- de la reserva. pg_net despierta una Edge Function después del commit y
-- pg_cron reintenta los envíos pendientes o fallidos cada cinco minutos.
-- ============================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table app_private.notification_worker_config (
  singleton boolean primary key default true check (singleton),
  worker_token text not null,
  created_at timestamptz not null default now()
);

insert into app_private.notification_worker_config (singleton, worker_token)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (singleton) do nothing;

alter table app_private.notification_worker_config enable row level security;
revoke all on app_private.notification_worker_config from public, anon, authenticated;

create table notification_outbox (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  reservation_id      uuid not null references reservations(id) on delete cascade,
  event_type           text not null check (
    event_type in ('reservation_created_admin', 'reservation_status_guest')
  ),
  reservation_status  reservation_status,
  recipient_email     text,
  idempotency_key     text not null unique,
  payload             jsonb not null default '{}'::jsonb,
  delivery_status     text not null default 'pending' check (
    delivery_status in ('pending', 'processing', 'sent', 'failed', 'skipped')
  ),
  attempt_count       int not null default 0 check (attempt_count >= 0),
  next_attempt_at     timestamptz,
  processing_started_at timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (
    (delivery_status = 'pending' and next_attempt_at is not null)
    or delivery_status <> 'pending'
  )
);

create index notification_outbox_ready_idx
  on notification_outbox (next_attempt_at, created_at)
  where delivery_status in ('pending', 'failed', 'processing');
create index notification_outbox_reservation_idx
  on notification_outbox (reservation_id, created_at desc);

alter table notification_outbox enable row level security;
revoke all on notification_outbox from public, anon, authenticated;

create trigger notification_outbox_set_updated_at
  before update on notification_outbox
  for each row execute function set_updated_at();

-- Verificación del secreto propio que protege la Edge Function. El token se
-- genera en Postgres y nunca se expone a anon/authenticated.
create or replace function is_notification_worker(p_token text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from app_private.notification_worker_config c
    where c.singleton and c.worker_token = p_token
  );
$$;

-- Reclamo atómico de eventos. SKIP LOCKED permite múltiples invocaciones sin
-- duplicar trabajo y recupera procesos que hayan quedado colgados por 10'.
create or replace function claim_notification_batch(
  p_worker_token text,
  p_limit int default 10
)
returns table (
  id uuid,
  event_type text,
  reservation_status reservation_status,
  recipient_email text,
  idempotency_key text,
  payload jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_notification_worker(p_worker_token) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  with candidates as (
    select n.id
    from public.notification_outbox n
    where n.attempt_count < 8
      and (
        (n.delivery_status in ('pending', 'failed') and n.next_attempt_at <= now())
        or (
          n.delivery_status = 'processing'
          and n.processing_started_at < now() - interval '10 minutes'
        )
      )
    order by n.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.notification_outbox n
     set delivery_status = 'processing',
         processing_started_at = now(),
         attempt_count = n.attempt_count + 1,
         last_error = null
    from candidates c
   where n.id = c.id
  returning n.id, n.event_type, n.reservation_status, n.recipient_email,
            n.idempotency_key, n.payload;
end;
$$;

create or replace function complete_notification(
  p_worker_token text,
  p_id uuid,
  p_provider_message_id text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_notification_worker(p_worker_token) then
    raise exception 'FORBIDDEN';
  end if;

  update public.notification_outbox
     set delivery_status = 'sent',
         sent_at = now(),
         provider_message_id = nullif(p_provider_message_id, ''),
         next_attempt_at = null,
         processing_started_at = null,
         last_error = null
   where id = p_id and delivery_status = 'processing';
  return found;
end;
$$;

create or replace function fail_notification(
  p_worker_token text,
  p_id uuid,
  p_error text
)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_notification_worker(p_worker_token) then
    raise exception 'FORBIDDEN';
  end if;

  update public.notification_outbox
     set delivery_status = 'failed',
         last_error = left(coalesce(p_error, 'UNKNOWN_ERROR'), 1000),
         next_attempt_at = case
           when attempt_count >= 8 then null
           else now() + make_interval(
             secs => least(3600, (60 * power(2, greatest(attempt_count - 1, 0)))::int)
           )
         end,
         processing_started_at = null
   where id = p_id and delivery_status = 'processing';
  return found;
end;
$$;

create or replace function skip_notification(
  p_worker_token text,
  p_id uuid,
  p_reason text
)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_notification_worker(p_worker_token) then
    raise exception 'FORBIDDEN';
  end if;

  update public.notification_outbox
     set delivery_status = 'skipped',
         last_error = left(coalesce(p_reason, 'SKIPPED'), 1000),
         next_attempt_at = null,
         processing_started_at = null
   where id = p_id and delivery_status = 'processing';
  return found;
end;
$$;

-- Despierta la Edge Function. El request de pg_net se ejecuta recién después
-- del commit, por lo que la función siempre ve el evento ya confirmado.
create or replace function wake_notification_worker()
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select worker_token into v_token
  from app_private.notification_worker_config
  where singleton;

  select net.http_post(
    url := 'https://guoxthaxwdsgwcsnvefq.supabase.co/functions/v1/notify-reservations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-token', v_token
    ),
    body := jsonb_build_object('source', 'notification_outbox'),
    timeout_milliseconds := 5000
  ) into v_request_id;

  return v_request_id;
end;
$$;

create or replace function enqueue_reservation_notification()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_property_name text;
  v_property_email text;
  v_unit_name text;
  v_guest_email text;
  v_admin_email text;
  v_payload jsonb;
begin
  select o.name, p.name, nullif(trim(p.email), ''), u.name,
         nullif(trim(g.email), '')
    into v_org_name, v_property_name, v_property_email, v_unit_name,
         v_guest_email
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
      v_admin_email := v_property_email;

      if v_admin_email is null then
        select nullif(trim(pr.email), '') into v_admin_email
        from public.memberships m
        join public.profiles pr on pr.id = m.user_id
        where m.organization_id = new.organization_id
          and m.role in ('owner', 'admin')
          and nullif(trim(pr.email), '') is not null
        order by case m.role when 'owner' then 0 else 1 end, m.created_at
        limit 1;
      end if;

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

  return new;
end;
$$;

create trigger reservations_enqueue_notification
  after insert or update of status on reservations
  for each row execute function enqueue_reservation_notification();

create or replace function wake_notification_worker_after_insert()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.delivery_status = 'pending' then
    perform public.wake_notification_worker();
  end if;
  return new;
end;
$$;

create trigger notification_outbox_wake_worker
  after insert on notification_outbox
  for each row execute function wake_notification_worker_after_insert();

-- Sólo la clave secreta/service role de la Edge Function puede consumir la cola.
revoke execute on function is_notification_worker(text) from public, anon, authenticated;
revoke execute on function claim_notification_batch(text,int) from public, authenticated;
revoke execute on function complete_notification(text,uuid,text) from public, authenticated;
revoke execute on function fail_notification(text,uuid,text) from public, authenticated;
revoke execute on function skip_notification(text,uuid,text) from public, authenticated;
revoke execute on function wake_notification_worker() from public, anon, authenticated;
revoke execute on function enqueue_reservation_notification() from public, anon, authenticated;
revoke execute on function wake_notification_worker_after_insert() from public, anon, authenticated;

grant execute on function is_notification_worker(text) to service_role;
-- La función usa una clave publishable/anon. Cada RPC valida además el token
-- aleatorio privado antes de tocar la outbox; no hay clave administrativa.
grant execute on function claim_notification_batch(text,int) to anon, service_role;
grant execute on function complete_notification(text,uuid,text) to anon, service_role;
grant execute on function fail_notification(text,uuid,text) to anon, service_role;
grant execute on function skip_notification(text,uuid,text) to anon, service_role;
grant execute on function wake_notification_worker() to service_role;

-- Reintentos para errores transitorios y recuperación de workers interrumpidos.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
  where jobname = 'notification-outbox-retry';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'notification-outbox-retry',
    '*/5 * * * *',
    'select public.wake_notification_worker();'
  );
end;
$$;
