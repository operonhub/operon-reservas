-- ============================================================
-- 0035 — Salud de los calendarios de Airbnb/Booking en el panel de Operon
-- ============================================================
-- El sync de cada hora (0023) devolvía los errores solo en su respuesta HTTP:
-- si el link de un cliente se rompía, nadie se enteraba hasta que aparecía un
-- overbooking. Ahora la Edge Function reporta el resultado de cada calendario
-- y el panel lo muestra por cliente.
--
-- Solo se guardan códigos (HTTP_404, NOT_ICAL, TIMEOUT…): los links de
-- exportación llevan un token secreto y un mensaje de error crudo podría
-- incluirlo. La base vuelve a filtrar por las dudas.
-- ============================================================

create schema if not exists app_private;

create table app_private.ical_sync_status (
  unit_id       uuid not null references public.units(id) on delete cascade,
  source        text not null check (source in ('airbnb', 'booking')),
  last_ok_at    timestamptz,
  last_error_at timestamptz,
  last_error    text check (last_error is null or last_error ~ '^[A-Z0-9_]{1,60}$'),
  failures      int not null default 0 check (failures >= 0),
  primary key (unit_id, source)
);
alter table app_private.ical_sync_status enable row level security;
revoke all on app_private.ical_sync_status from public, anon, authenticated;

-- Lo llama la Edge Function al terminar cada corrida.
create function public.report_ical_sync_results(p_worker_token text, p_results jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if not public.is_ical_sync_worker(p_worker_token) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception 'INVALID_RESULTS'; end if;
  if jsonb_array_length(p_results) > 2000 then raise exception 'TOO_MANY_RESULTS'; end if;

  with incoming as (
    -- Una fila por calendario aunque venga repetido (ON CONFLICT no admite
    -- tocar la misma fila dos veces en una sentencia).
    select distinct on (u.id, e->>'source')
           u.id as unit_id,
           e->>'source' as source,
           (e->>'ok')::boolean as ok,
           case when e->>'error' ~ '^[A-Z0-9_]{1,60}$' then e->>'error' else 'SYNC_FAILED' end as error
      from jsonb_array_elements(p_results) e
      join public.units u
        on (e->>'unit_id') ~ '^[0-9a-fA-F-]{36}$' and u.id = (e->>'unit_id')::uuid
     where e->>'source' in ('airbnb', 'booking')
       and jsonb_typeof(e->'ok') = 'boolean'
     order by u.id, e->>'source'
  ), upserted as (
    insert into app_private.ical_sync_status as s
      (unit_id, source, last_ok_at, last_error_at, last_error, failures)
    select unit_id, source,
           case when ok then now() end,
           case when not ok then now() end,
           case when not ok then error end,
           case when ok then 0 else 1 end
      from incoming
    on conflict (unit_id, source) do update set
      last_ok_at    = coalesce(excluded.last_ok_at, s.last_ok_at),
      last_error_at = coalesce(excluded.last_error_at, s.last_error_at),
      last_error    = case when excluded.last_error_at is not null then excluded.last_error else s.last_error end,
      failures      = case when excluded.last_ok_at is not null then 0 else s.failures + 1 end
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end; $$;

revoke all on function public.report_ical_sync_results(text, jsonb) from public, anon, authenticated;
grant execute on function public.report_ical_sync_results(text, jsonb) to service_role;

-- Estado de cada calendario configurado, para el listado (p_org null) y la
-- ficha. Nunca la URL: solo si está configurada y cómo le fue.
--   paused  el complejo está suspendido (0033 pausa la importación)
--   pending todavía no corrió ningún sync desde que se configuró
--   error   el último intento falló
--   stale   anduvo, pero hace más de 3 horas que no sincroniza (corre cada hora)
--   ok
create function public.operon_ical_overview(p_org uuid default null)
returns table (
  organization_id uuid,
  unit_id         uuid,
  unit_name       text,
  source          text,
  state           text,
  last_ok_at      timestamptz,
  last_error_at   timestamptz,
  last_error      text,
  failures        int
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  return query
  select u.organization_id, u.id, u.name, c.source,
         case
           when o.suspended_at is not null then 'paused'
           when st.last_ok_at is null and st.last_error_at is null then 'pending'
           when st.last_error_at > coalesce(st.last_ok_at, '-infinity'::timestamptz) then 'error'
           when st.last_ok_at < now() - interval '3 hours' then 'stale'
           else 'ok'
         end,
         st.last_ok_at, st.last_error_at, st.last_error, coalesce(st.failures, 0)
    from public.units u
    join public.organizations o on o.id = u.organization_id
    cross join lateral (
      select 'airbnb'::text as source where u.airbnb_ical_url is not null
      union all
      select 'booking' where u.booking_ical_url is not null
    ) c
    left join app_private.ical_sync_status st on st.unit_id = u.id and st.source = c.source
   where u.is_active
     and (p_org is null or u.organization_id = p_org)
   order by u.organization_id, u.position, u.name, c.source;
end; $$;

revoke execute on function public.operon_ical_overview(uuid) from public, anon;
grant execute on function public.operon_ical_overview(uuid) to authenticated;
