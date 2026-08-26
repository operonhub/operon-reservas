-- ============================================================
-- Operon Reservas — import de calendarios externos (Airbnb/Booking)
-- ============================================================
-- Ya exportamos un iCal por unidad (0018) para que Airbnb/Booking bloqueen
-- SU calendario cuando reservan por acá. Falta el sentido inverso: leer el
-- iCal que exportan ELLOS, para bloquear unit_occupancy cuando reservan
-- directo en esas plataformas, y evitar overbooking cruzado.
--
-- Alcance: sólo bloquear fechas (kind='block', igual que la carga manual de
-- 0001/0003) — nunca se crea una fila en `reservations`. Es justo lo único
-- que el iCal de Airbnb/Booking expone de todos modos (sin huésped, sin
-- monto), así que no hay más información para aprovechar.
--
-- Config: cada unidad guarda la URL de "exportar calendario" que el dueño
-- copia desde su propio panel de Airbnb/Booking (no requiere que Operon
-- tenga sus credenciales — son URLs de lectura pública tipo webcal/ics).
--
-- Diseño espejo del resto de los workers de este proyecto:
--   * app_private.ical_sync_worker_config, mismo patrón que
--     notification_worker_config (0006): token aleatorio de 256 bits,
--     revocado de todos los roles, sólo accesible vía RPC.
--   * wake_ical_sync_worker() + pg_net, igual que wake_notification_worker.
--   * pg_cron cada hora (no cada 5' como notificaciones/expiración: acá
--     hay varios fetch HTTP a servidores de terceros por corrida, no tiene
--     sentido pollear tan seguido).
-- ============================================================

-- ---------- Config por unidad ----------
alter table units
  add column airbnb_ical_url  text,
  add column booking_ical_url text;
-- Sin validación estricta de formato: alcanza con que no esté vacía. La UI
-- puede sugerir "empieza con http" pero no hay nada que valga la pena
-- forzar a nivel base (Airbnb/Booking podrían cambiar el esquema del link).

-- ---------- Tracking de bloqueos importados ----------
-- external_source/external_uid identifican de forma estable un evento del
-- iCal de origen, para poder actualizarlo o borrarlo en corridas
-- posteriores sin duplicar ni tocar reservas reales ni bloqueos manuales
-- (esos siguen con external_source/external_uid null, como siempre).
alter table unit_occupancy
  add column external_source text check (external_source in ('airbnb','booking')),
  add column external_uid    text;

alter table unit_occupancy
  add constraint unit_occupancy_external_pair_chk
  check ( (external_source is null) = (external_uid is null) );

-- Idempotencia del sync: mismo (unidad, plataforma, evento del iCal) es
-- siempre la misma fila — un re-sync actualiza en vez de duplicar.
create unique index unit_occupancy_external_uidx
  on unit_occupancy (unit_id, external_source, external_uid)
  where external_source is not null;

-- ---------- Config + secreto del worker ----------
create table app_private.ical_sync_worker_config (
  singleton    boolean primary key default true check (singleton),
  worker_token text not null,
  created_at   timestamptz not null default now()
);

insert into app_private.ical_sync_worker_config (singleton, worker_token)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (singleton) do nothing;

alter table app_private.ical_sync_worker_config enable row level security;
revoke all on app_private.ical_sync_worker_config from public, anon, authenticated;

-- ---------- Helpers ----------
create or replace function is_ical_sync_worker(p_token text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from app_private.ical_sync_worker_config c
    where c.singleton and c.worker_token = p_token
  );
$$;

-- Unidades activas con al menos una plataforma configurada. Sin token: el
-- acceso lo da únicamente el GRANT a service_role (igual que mp_service_*).
create or replace function list_units_for_ical_sync()
returns table (
  unit_id           uuid,
  organization_id   uuid,
  airbnb_ical_url   text,
  booking_ical_url  text
)
language sql stable security definer set search_path = '' as $$
  select id, organization_id, airbnb_ical_url, booking_ical_url
  from public.units
  where is_active
    and (airbnb_ical_url is not null or booking_ical_url is not null);
$$;

-- Corazón del sync: recibe los rangos YA parseados del iCal (la Edge
-- Function hace el parsing; acá sólo se persiste). Un solape puntual con
-- otra fila (bloqueo manual o reserva real) se salta y se cuenta aparte —
-- nunca aborta el resto del batch ni de las demás unidades.
create or replace function sync_unit_external_blocks(
  p_worker_token text,
  p_unit_id uuid,
  p_source text,
  p_ranges jsonb
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
    -- Entrada corrupta del parser (rango invertido, fechas faltantes): se
    -- ignora en silencio, no cuenta ni como error ni como éxito.
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
      -- Choca con un bloqueo/reserva de otra fuente: se salta esa fecha
      -- puntual, no tira abajo el resto del sync.
      v_skipped := v_skipped + 1;
    end;
  end loop;

  -- Lo que ya no está en el feed de origen (se canceló o quedó afuera del
  -- rango que exportan) se borra — libera la fecha en unit_occupancy.
  v_uids := array(
    select value->>'uid'
    from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) as value
    where value->>'uid' is not null
  );

  with removed as (
    delete from public.unit_occupancy
    where unit_id = p_unit_id
      and external_source = p_source
      and not (external_uid = any(v_uids))
    returning 1
  )
  select count(*) into v_removed from removed;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'removed', v_removed,
    'skipped_conflicts', v_skipped
  );
end;
$$;

-- Despierta la Edge Function. El fetch HTTP a Airbnb/Booking + parseo no es
-- instantáneo como el de notificaciones: timeout más generoso.
create or replace function wake_ical_sync_worker()
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select worker_token into v_token
  from app_private.ical_sync_worker_config
  where singleton;

  select net.http_post(
    url := 'https://guoxthaxwdsgwcsnvefq.supabase.co/functions/v1/sync-external-calendars',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-token', v_token
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

-- ---------- Permisos: sólo la Edge Function (service_role) ----------
revoke execute on function is_ical_sync_worker(text) from public, anon, authenticated;
revoke execute on function list_units_for_ical_sync() from public, anon, authenticated;
revoke execute on function sync_unit_external_blocks(text,uuid,text,jsonb) from public, anon, authenticated;
revoke execute on function wake_ical_sync_worker() from public, anon, authenticated;

grant execute on function is_ical_sync_worker(text) to service_role;
grant execute on function list_units_for_ical_sync() to service_role;
grant execute on function sync_unit_external_blocks(text,uuid,text,jsonb) to service_role;
grant execute on function wake_ical_sync_worker() to service_role;

-- ---------- Cron: cada hora ----------
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
  where jobname = 'sync-external-calendars';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'sync-external-calendars',
    '0 * * * *',
    'select public.wake_ical_sync_worker();'
  );
end;
$$;
