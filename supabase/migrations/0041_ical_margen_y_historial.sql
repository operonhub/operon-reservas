-- ============================================================
-- 0041 — Sync de calendarios: margen de seguridad + historial de borrados
-- ============================================================
-- Qué pasó (2026-10-06, Cabañas 4 Elementos): el feed de Booking de dos
-- unidades dejó de publicar reservas que SEGUÍAN vigentes en Booking (AIRE
-- 6→2 eventos, FUEGO 7→0 con un VCALENDAR válido pero vacío). El sync leyó
-- "ya no están" como "se cancelaron" y liberó fechas vendidas: riesgo real de
-- overbooking. Además no quedó registro de qué se borró ni cuándo.
--
-- Cambios:
--  1) Un bloque importado que falta en el feed NO se borra al instante: se
--     cuenta en cuántas corridas SEGUIDAS falta (missing_count) y mientras
--     tanto sigue bloqueando la fecha. Se borra recién cuando falta
--       * 3 corridas seguidas (~3 h)  → una cancelación normal, o
--       * 24 corridas seguidas (~24 h) → si faltan a la vez 2 o más bloques
--         y son la mitad o más de los que había: eso casi nunca es un
--         conjunto de cancelaciones, es un feed roto.
--     Si el bloque reaparece antes, el contador vuelve a 0.
--     Los bloques de estadías ya terminadas se limpian al instante (ya no
--     afectan la disponibilidad).
--  2) app_private.ical_sync_history: quién (unidad/plataforma/uid), qué
--     fechas y cuándo — empezó a faltar, se borró, o reapareció.
--     operon_ical_history() lo expone solo a admins de Operon.
--
-- La firma de sync_unit_external_blocks NO cambia (la Edge Function sigue
-- igual). p_allow_empty se mantiene: un feed vacío sin esa confirmación sigue
-- sin contar como "faltantes" (puede ser un error de lectura, no un feed real).
-- ============================================================

-- ---------- 1) Estado de "faltante" por bloque ----------
alter table unit_occupancy
  add column missing_count int not null default 0 check (missing_count >= 0),
  add column missing_since timestamptz;

-- ---------- 2) Historial ----------
create table app_private.ical_sync_history (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  organization_id uuid not null,
  unit_id         uuid not null,
  source          text not null check (source in ('airbnb', 'booking')),
  external_uid    text not null,
  during          daterange not null,
  action          text not null check (action in ('missing_started', 'recovered', 'removed')),
  missing_count   int not null default 0,
  mass_drop       boolean not null default false,
  feed_events     int
);
create index ical_sync_history_unit_idx on app_private.ical_sync_history (unit_id, at desc);
create index ical_sync_history_org_idx  on app_private.ical_sync_history (organization_id, at desc);
alter table app_private.ical_sync_history enable row level security;
revoke all on app_private.ical_sync_history from public, anon, authenticated;

-- ---------- 3) Sync con margen ----------
create or replace function public.sync_unit_external_blocks(
  p_worker_token text,
  p_unit_id uuid,
  p_source text,
  p_ranges jsonb,
  p_allow_empty boolean default false
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_grace_normal constant int := 3;    -- corridas seguidas (cancelación normal)
  c_grace_mass   constant int := 24;   -- corridas seguidas (desaparición masiva)
  v_org uuid;
  v_uids text[];
  v_feed_events int;
  v_inserted int := 0;
  v_updated int := 0;
  v_removed int := 0;
  v_skipped int := 0;
  v_pending int := 0;
  v_past int := 0;
  v_was_insert boolean;
  v_empty_guard boolean := false;
  v_future_total int;
  v_missing int;
  v_mass boolean := false;
  v_limit int;
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

  v_uids := array(
    select value->>'uid'
    from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) as value
    where value->>'uid' is not null
  );
  v_feed_events := cardinality(v_uids);

  -- Reaparecieron: estaban "faltando" y vuelven a venir en el feed.
  with back as (
    update public.unit_occupancy
       set missing_count = 0, missing_since = null
     where unit_id = p_unit_id and external_source = p_source
       and missing_count > 0 and external_uid = any(v_uids)
    returning organization_id, unit_id, external_source, external_uid, during
  )
  insert into app_private.ical_sync_history
    (organization_id, unit_id, source, external_uid, during, action, feed_events)
  select organization_id, unit_id, external_source, external_uid, during, 'recovered', v_feed_events
    from back;

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

  -- Sin ningún uid en el feed sólo se sigue con confirmación explícita del
  -- worker (VCALENDAR válido y vacío). Si no, no se toca nada.
  if v_feed_events = 0 and not coalesce(p_allow_empty, false) then
    v_empty_guard := true;
  else
    -- Estadías ya terminadas que salieron del feed: ya no bloquean nada.
    with gone as (
      delete from public.unit_occupancy
       where unit_id = p_unit_id and external_source = p_source
         and not (external_uid = any(v_uids))
         and upper(during) <= current_date
      returning 1
    )
    select count(*) into v_past from gone;

    -- ¿Cuántos bloques vigentes había y cuántos faltan ahora?
    select count(*),
           count(*) filter (where not (external_uid = any(v_uids)))
      into v_future_total, v_missing
      from public.unit_occupancy
     where unit_id = p_unit_id and external_source = p_source
       and upper(during) > current_date;

    v_mass := v_missing >= 2 and v_missing * 2 >= v_future_total;
    v_limit := case when v_mass then c_grace_mass else c_grace_normal end;

    -- Los que faltan: se cuenta una corrida más y siguen bloqueando.
    with missing as (
      update public.unit_occupancy
         set missing_count = missing_count + 1,
             missing_since = coalesce(missing_since, now())
       where unit_id = p_unit_id and external_source = p_source
         and upper(during) > current_date
         and not (external_uid = any(v_uids))
      returning organization_id, unit_id, external_source, external_uid, during,
                missing_count
    ), started as (
      insert into app_private.ical_sync_history
        (organization_id, unit_id, source, external_uid, during, action,
         missing_count, mass_drop, feed_events)
      select organization_id, unit_id, external_source, external_uid, during,
             'missing_started', missing_count, v_mass, v_feed_events
        from missing
       where missing_count = 1
    )
    select count(*) into v_pending from missing;

    -- Los que ya superaron el margen: ahí sí se liberan, y queda registrado.
    with removed as (
      delete from public.unit_occupancy
       where unit_id = p_unit_id and external_source = p_source
         and upper(during) > current_date
         and not (external_uid = any(v_uids))
         and missing_count >= v_limit
      returning organization_id, unit_id, external_source, external_uid, during,
                missing_count
    ), logged as (
      insert into app_private.ical_sync_history
        (organization_id, unit_id, source, external_uid, during, action,
         missing_count, mass_drop, feed_events)
      select organization_id, unit_id, external_source, external_uid, during,
             'removed', missing_count, v_mass, v_feed_events
        from removed
    )
    select count(*) into v_removed from removed;

    v_pending := greatest(v_pending - v_removed, 0);
    v_removed := v_removed + v_past;
  end if;

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'removed', v_removed,
    'skipped_conflicts', v_skipped,
    'empty_feed_ignored', v_empty_guard,
    'pending_removal', v_pending,
    'mass_drop', v_mass
  );
end;
$$;

revoke execute on function public.sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  to service_role;

-- ---------- 4) Historial para el panel de Operon ----------
create function public.operon_ical_history(p_org uuid default null, p_limit int default 200)
returns table (
  at              timestamptz,
  organization_id uuid,
  unit_id         uuid,
  unit_name       text,
  source          text,
  action          text,
  desde           date,
  hasta           date,
  missing_count   int,
  mass_drop       boolean,
  feed_events     int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  return query
  select h.at, h.organization_id, h.unit_id, u.name, h.source, h.action,
         lower(h.during), upper(h.during), h.missing_count, h.mass_drop, h.feed_events
    from app_private.ical_sync_history h
    left join public.units u on u.id = h.unit_id
   where p_org is null or h.organization_id = p_org
   order by h.at desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
end; $$;

revoke execute on function public.operon_ical_history(uuid, int) from public, anon;
grant execute on function public.operon_ical_history(uuid, int) to authenticated;
