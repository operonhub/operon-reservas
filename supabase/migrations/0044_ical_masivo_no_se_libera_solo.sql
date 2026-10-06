-- ============================================================
-- 0044 — Varias reservas que desaparecen juntas no se liberan solas
-- ============================================================
-- Decisión de producto (Santiago, 2026-10-06). 0041/0043 liberaban a las 24 h
-- los bloques que desaparecían en masa del feed. Con el eco de 0042 eso habría
-- soltado reservas reales de Cabañas 4 Elementos al día siguiente.
--
-- Ahora:
--   * Una fecha suelta que deja de venir se libera sola a las 3 corridas y
--     3 horas (cancelación normal). Sin cambios.
--   * Si faltan a la vez 2 o más bloques y son la mitad o más, NO se libera
--     ninguno solo. Siguen bloqueando hasta que el feed los vuelva a traer o
--     alguien los libere: el dueño borrando el bloqueo en su calendario, o un
--     admin de Operon desde la ficha del cliente (operon_ical_release).
--   * operon_ical_attention dice, de cada fecha en duda, si se va a liberar
--     sola o si espera a una persona, y trae el id para poder liberarla.
--
-- Bloquear de más cuesta una venta que espera y se ve en el panel; liberar de
-- más cuesta una sobreventa. La firma del sync no cambia.
-- ============================================================

-- ---------- 1) El sync, con la política nueva ----------
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
  c_runs constant int := 3;                     -- corridas seguidas en falta
  c_wait constant interval := interval '3 hours';  -- y además este tiempo
  v_org uuid;
  v_now timestamptz := now();
  v_today date := current_date;
  v_ahead datemultirange;      -- de hoy en adelante
  v_feed_events int;
  v_events jsonb;              -- eventos válidos del feed: [{uid, s, e}]
  v_uids text[];
  v_old_uids text[];
  v_feed datemultirange;       -- todos los días que el feed da por ocupados
  v_other datemultirange;      -- días ya ocupados en Operon por otra cosa
  v_future_total int := 0;
  v_missing int := 0;
  v_mass boolean := false;
  v_stale jsonb;               -- tramos que el feed dejó de traer
  v_target jsonb;              -- cómo tienen que quedar los bloques de esta plataforma
  v_hits jsonb;                -- choques con reservas de Operon u otra plataforma
  v_inserted int := 0;
  v_updated int := 0;
  v_removed int := 0;
  v_past int := 0;
  v_skipped int := 0;
  v_race int := 0;
  v_pending int := 0;
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

  -- Una sola corrida a la vez por unidad y plataforma (el cron y una forzada).
  perform pg_advisory_xact_lock(hashtextextended(p_unit_id::text || ':' || p_source, 0));

  select count(*) into v_feed_events
    from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) as value
   where value->>'uid' is not null;

  -- Sin ningún evento sólo se sigue con confirmación explícita del worker
  -- (VCALENDAR válido y vacío). Si no, no se toca nada (0024).
  if v_feed_events = 0 and not coalesce(p_allow_empty, false) then
    return jsonb_build_object(
      'inserted', 0, 'updated', 0, 'removed', 0, 'skipped_conflicts', 0,
      'empty_feed_ignored', true, 'pending_removal', 0, 'mass_drop', false, 'collisions', 0);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('uid', x.uid, 's', x.s, 'e', x.e) order by x.s, x.uid), '[]'::jsonb)
    into v_events
    from (
      select distinct on (value->>'uid')
             value->>'uid' as uid,
             nullif(value->>'start_date', '')::date as s,
             nullif(value->>'end_date', '')::date as e
        from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) as value
       where value->>'uid' is not null
       order by value->>'uid'
    ) x
   where x.s is not null and x.e is not null and x.e > x.s;

  v_uids := array(select x->>'uid' from jsonb_array_elements(v_events) x);
  v_ahead := datemultirange(daterange(v_today, null, '[)'));

  select coalesce(range_agg(daterange((x->>'s')::date, (x->>'e')::date, '[)')), '{}'::datemultirange)
    into v_feed
    from jsonb_array_elements(v_events) x;

  select coalesce(range_agg(o.during), '{}'::datemultirange)
    into v_other
    from public.unit_occupancy o
   where o.unit_id = p_unit_id and o.external_source is distinct from p_source;

  v_old_uids := array(
    select o.external_uid from public.unit_occupancy o
     where o.unit_id = p_unit_id and o.external_source = p_source);

  -- ¿Cuántos bloques vigentes había y a cuántos les faltan días en el feed?
  -- Un bloque que solo cambió de forma (el feed sigue cubriendo sus días) no falta.
  select count(*),
         count(*) filter (where not isempty((datemultirange(o.during) - v_feed) * v_ahead))
    into v_future_total, v_missing
    from public.unit_occupancy o
   where o.unit_id = p_unit_id and o.external_source = p_source
     and upper(o.during) > v_today;

  -- Que falten a la vez 2 o más bloques y sean la mitad o más casi nunca es un
  -- conjunto de cancelaciones: es un feed roto, un link cambiado o un eco. En
  -- ese caso no se libera NADA solo, pase el tiempo que pase: siguen bloqueando
  -- hasta que el feed las vuelva a traer o alguien las libere a mano.
  v_mass := v_missing >= 2 and v_missing * 2 >= v_future_total;

  -- ---------- Días que el feed dejó de traer ----------
  -- Un elemento por tramo: sigue bloqueando, o ya cumplió el margen ('free').
  select coalesce(jsonb_agg(jsonb_build_object(
           'uid', q.uid, 'old_during', q.during::text, 'frag', q.frag::text,
           'mc', q.missing_count + 1, 'ms', coalesce(q.missing_since, v_now), 'hold', q.hold_until,
           'first', q.missing_count = 0,
           'free', (not v_mass
                    and q.missing_count + 1 >= c_runs
                    and coalesce(q.missing_since, v_now) <= v_now - c_wait
                    and (q.hold_until is null or q.hold_until <= v_now)))), '[]'::jsonb)
    into v_stale
    from (
      select o.external_uid as uid, o.during, o.missing_count, o.missing_since, o.hold_until, s.frag
        from public.unit_occupancy o
       cross join lateral unnest((datemultirange(o.during) - v_feed) * v_ahead) as s(frag)
       where o.unit_id = p_unit_id and o.external_source = p_source
    ) q;

  select count(*) filter (where (t->>'free')::boolean),
         count(*) filter (where not (t->>'free')::boolean)
    into v_removed, v_pending
    from jsonb_array_elements(v_stale) t;

  -- ---------- Historial (antes de tocar nada) ----------
  insert into app_private.ical_sync_history
    (organization_id, unit_id, source, external_uid, during, action, missing_count, mass_drop, feed_events)
  select v_org, p_unit_id, p_source, t->>'uid', (t->>'frag')::daterange,
         case when (t->>'free')::boolean then 'removed' else 'missing_started' end,
         (t->>'mc')::int, v_mass, v_feed_events
    from jsonb_array_elements(v_stale) t
   where (t->>'free')::boolean or (t->>'first')::boolean
  union all
  select v_org, p_unit_id, p_source, o.external_uid, o.during, 'recovered', 0, false, v_feed_events
    from public.unit_occupancy o
   where o.unit_id = p_unit_id and o.external_source = p_source
     and o.missing_count > 0 and upper(o.during) > v_today
     and isempty((datemultirange(o.during) - v_feed) * v_ahead);

  -- ---------- Cómo tiene que quedar ----------
  with ev as (
    select x->>'uid' as uid, daterange((x->>'s')::date, (x->>'e')::date, '[)') as r
      from jsonb_array_elements(v_events) x
  ), ev2 as (
    -- Si dos eventos del feed se pisan entre sí, el segundo solo aporta lo que sobra.
    select ev.uid, ev.r,
           coalesce(range_agg(ev.r) over (order by lower(ev.r), ev.uid
                                          rows between unbounded preceding and 1 preceding),
                    '{}'::datemultirange) as prev
      from ev
  ), fresh as (
    -- Días que el feed da por ocupados, menos lo que en Operon ya ocupa otra
    -- cosa (reserva, bloqueo manual, otra plataforma): se bloquea lo que sobra.
    select ev2.uid, f.frag,
           row_number() over (partition by ev2.uid order by f.frag) as n
      from ev2 cross join lateral unnest(datemultirange(ev2.r) - v_other - ev2.prev) as f(frag)
  ), kept as (
    select t->>'uid' as old_uid, (t->>'old_during')::daterange as old_during,
           (t->>'frag')::daterange as frag, (t->>'mc')::int as mc,
           (t->>'ms')::timestamptz as ms, (t->>'hold')::timestamptz as hold
      from jsonb_array_elements(v_stale) t
     where not (t->>'free')::boolean
  ), target as (
    select case when fresh.n = 1 then fresh.uid else fresh.uid || '#' || fresh.n end as uid,
           fresh.frag as during, 0 as mc, null::timestamptz as ms, null::timestamptz as hold
      from fresh
    union all
    -- El bloque entero sigue faltando: es la misma fila, con una corrida más.
    -- Si solo le falta una parte (o su uid volvió con otras fechas), el resto
    -- queda en una fila propia para no pisar el uid del evento vigente.
    select case
             when kept.frag = kept.old_during
                  and not (split_part(split_part(kept.old_uid, '~', 1), '#', 1) = any (v_uids))
               then kept.old_uid
             else split_part(kept.old_uid, '~', 1) || '~' || to_char(lower(kept.frag), 'YYYYMMDD')
           end,
           kept.frag, kept.mc, kept.ms, kept.hold
      from kept
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'uid', target.uid, 'during', target.during::text,
           'mc', target.mc, 'ms', target.ms, 'hold', target.hold)), '[]'::jsonb)
    into v_target
    from target;

  -- ---------- Aplicar: primero sale lo que no corresponde, después entra lo nuevo ----------
  -- Todo en la misma transacción: entre el borrado y el alta nadie ve la fecha libre.
  with gone as (
    delete from public.unit_occupancy o
     where o.unit_id = p_unit_id and o.external_source = p_source
       and not exists (
         select 1 from jsonb_array_elements(v_target) t
          where t->>'uid' = o.external_uid and (t->>'during')::daterange = o.during)
    returning o.during
  )
  -- Estadías ya terminadas que salieron del feed: no bloqueaban nada.
  select count(*) filter (where upper(gone.during) <= v_today and not (gone.during <@ v_feed))
    into v_past
    from gone;

  update public.unit_occupancy o
     set missing_count = (t->>'mc')::int,
         missing_since = (t->>'ms')::timestamptz,
         hold_until    = (t->>'hold')::timestamptz
    from jsonb_array_elements(v_target) t
   where o.unit_id = p_unit_id and o.external_source = p_source
     and o.external_uid = t->>'uid' and o.during = (t->>'during')::daterange
     and (o.missing_count, o.missing_since, o.hold_until)
         is distinct from ((t->>'mc')::int, (t->>'ms')::timestamptz, (t->>'hold')::timestamptz);

  for r in
    select t->>'uid' as uid, (t->>'during')::daterange as during,
           (t->>'mc')::int as mc, (t->>'ms')::timestamptz as ms, (t->>'hold')::timestamptz as hold
      from jsonb_array_elements(v_target) t
     where not exists (
       select 1 from public.unit_occupancy o
        where o.unit_id = p_unit_id and o.external_source = p_source
          and o.external_uid = t->>'uid' and o.during = (t->>'during')::daterange)
     order by (t->>'during')::daterange
  loop
    begin
      insert into public.unit_occupancy
        (organization_id, unit_id, during, kind, external_source, external_uid,
         missing_count, missing_since, hold_until)
      values (v_org, p_unit_id, r.during, 'block', p_source, r.uid, r.mc, r.ms, r.hold);

      if r.mc = 0 then
        if split_part(r.uid, '#', 1) = any (v_old_uids) then
          v_updated := v_updated + 1;   -- el mismo evento, con otras fechas
        else
          v_inserted := v_inserted + 1;
        end if;
      end if;
    exception when exclusion_violation or unique_violation then
      -- Alguien reservó esos días mientras corría el sync, o el feed trae un
      -- uid que choca con uno guardado: se saltea ese tramo y la próxima
      -- corrida lo resuelve.
      v_race := v_race + 1;
    end;
  end loop;

  -- ---------- Choques: la plataforma da por ocupado algo que Operon ya tenía ----------
  -- skipped_conflicts: eventos que pisan algo ya ocupado en Operon (se bloqueó
  -- lo que sobraba a los costados). De esos, los que pisan una reserva u otra
  -- plataforma son una posible sobreventa y quedan anotados.
  select count(*) into v_skipped
    from jsonb_array_elements(v_events) x
   where daterange((x->>'s')::date, (x->>'e')::date, '[)') && v_other;
  v_skipped := v_skipped + v_race;

  select coalesce(jsonb_agg(jsonb_build_object(
           'during', h.r::text, 'other_during', h.other_during::text,
           'other_kind', h.other_kind, 'reservation_id', h.reservation_id)), '[]'::jsonb)
    into v_hits
    from (
      select distinct
             daterange((x->>'s')::date, (x->>'e')::date, '[)') as r,
             o.during as other_during,
             case when o.kind = 'reservation' then 'reservation' else o.external_source end as other_kind,
             o.reservation_id
        from jsonb_array_elements(v_events) x
        join public.unit_occupancy o
          on o.unit_id = p_unit_id
         and o.during && daterange((x->>'s')::date, (x->>'e')::date, '[)')
        left join public.reservations res on res.id = o.reservation_id
       where o.external_source is distinct from p_source
         and upper(o.during) > v_today
         -- Un bloqueo manual no es un choque: la fecha ya estaba cuidada.
         and (o.kind = 'reservation' or o.external_source is not null)
         -- Tampoco una reserva que el dueño cargó como venida de esa misma plataforma.
         and (res.id is null or (res.source::text <> p_source
                                 and coalesce(res.external_channel, '') <> p_source))
    ) h;

  insert into app_private.ical_sync_conflicts
    (organization_id, unit_id, source, during, other_kind, reservation_id, other_during,
     first_seen_at, last_seen_at)
  select v_org, p_unit_id, p_source, (h->>'during')::daterange, h->>'other_kind',
         (h->>'reservation_id')::uuid, (h->>'other_during')::daterange, v_now, v_now
    from jsonb_array_elements(v_hits) h
  on conflict (unit_id, source, during, other_kind, other_during) where resolved_at is null
    do update set last_seen_at = excluded.last_seen_at;

  -- Los que ya no se pisan (se canceló de un lado o del otro) se dan por resueltos.
  update app_private.ical_sync_conflicts c
     set resolved_at = v_now
   where c.unit_id = p_unit_id and c.source = p_source and c.resolved_at is null
     and not exists (
       select 1 from jsonb_array_elements(v_hits) h
        where (h->>'during')::daterange = c.during
          and (h->>'other_during')::daterange = c.other_during
          and h->>'other_kind' = c.other_kind);

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'removed', v_removed + v_past,
    'skipped_conflicts', v_skipped,
    'empty_feed_ignored', false,
    'pending_removal', v_pending,
    'mass_drop', v_mass,
    'collisions', jsonb_array_length(v_hits)
  );
end;
$$;

revoke execute on function public.sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  to service_role;

revoke execute on function public.sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.sync_unit_external_blocks(text, uuid, text, jsonb, boolean)
  to service_role;

-- ---------- 2) Liberar a mano una fecha en duda (admins de Operon) ----------
alter table app_private.admin_audit_log drop constraint admin_audit_log_action_check;
alter table app_private.admin_audit_log add constraint admin_audit_log_action_check check (action in (
  'org.suspend', 'org.reactivate', 'member.remove', 'member.recovery_link',
  'invitation.create', 'invitation.revoke',
  'zone_month.enable', 'zone_month.disable', 'zone_month.queue',
  'website.set', 'website.check',
  'ical.release'
));

alter table app_private.ical_sync_history drop constraint ical_sync_history_action_check;
alter table app_private.ical_sync_history add constraint ical_sync_history_action_check
  check (action in ('missing_started', 'recovered', 'removed', 'released_by_admin'));

-- Solo fechas EN DUDA: importadas y que la plataforma dejó de informar (o que
-- están en espera). Una que el feed sigue trayendo no se puede liberar desde
-- acá: la próxima corrida la volvería a bloquear.
create function public.operon_ical_release(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.unit_occupancy;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v from public.unit_occupancy where id = p_id for update;
  if not found then raise exception 'BLOCK_NOT_FOUND'; end if;
  if v.external_source is null then raise exception 'NOT_IMPORTED'; end if;
  if v.missing_count = 0 and v.hold_until is null then raise exception 'NOT_IN_DOUBT'; end if;

  delete from public.unit_occupancy where id = p_id;

  insert into app_private.ical_sync_history
    (organization_id, unit_id, source, external_uid, during, action, missing_count)
  values (v.organization_id, v.unit_id, v.external_source, v.external_uid, v.during,
          'released_by_admin', v.missing_count);

  perform app_private.log_admin_action('ical.release', v.organization_id, null,
    jsonb_build_object('unit_id', v.unit_id, 'source', v.external_source,
                       'desde', lower(v.during), 'hasta', upper(v.during)));

  return jsonb_build_object('desde', lower(v.during), 'hasta', upper(v.during));
end; $$;

revoke execute on function public.operon_ical_release(uuid) from public, anon;
grant execute on function public.operon_ical_release(uuid) to authenticated;

-- ---------- 3) La lista de pendientes dice qué va a pasar con cada fecha ----------
-- Cambian las columnas de salida: hay que dropear.
drop function public.operon_ical_attention(uuid);

create function public.operon_ical_attention(p_org uuid default null)
returns table (
  kind             text,        -- 'missing' | 'conflict'
  id               uuid,        -- el bloque (para liberarlo); nulo en los choques
  organization_id  uuid,
  unit_id          uuid,
  unit_name        text,
  source           text,
  desde            date,
  hasta            date,
  since            timestamptz,
  missing_count    int,
  hold_until       timestamptz,
  auto_release     boolean,     -- se libera sola si sigue faltando
  other_kind       text,
  other_desde      date,
  other_hasta      date,
  reservation_code text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  return query
  select x.* from (
    select 'missing'::text, i.id, i.organization_id, i.unit_id, u.name, i.external_source,
           lower(i.during), upper(i.during), i.missing_since, i.missing_count, i.hold_until,
           (i.hold_until is null or i.hold_until <= now())
             and not (i.miss >= 2 and i.miss * 2 >= i.total),
           null::text, null::date, null::date, null::text
      from (
        select o.*,
               count(*) over w as total,
               count(*) filter (where o.missing_count > 0) over w as miss
          from public.unit_occupancy o
         where o.external_source is not null and upper(o.during) > current_date
        window w as (partition by o.unit_id, o.external_source)
      ) i
      join public.units u on u.id = i.unit_id
     where (i.missing_count > 0 or i.hold_until is not null)
       and (p_org is null or i.organization_id = p_org)
    union all
    select 'conflict'::text, null::uuid, c.organization_id, c.unit_id, u.name, c.source,
           lower(c.during), upper(c.during), c.first_seen_at, 0, null::timestamptz,
           false,
           c.other_kind, lower(c.other_during), upper(c.other_during), res.code
      from app_private.ical_sync_conflicts c
      join public.units u on u.id = c.unit_id
      left join public.reservations res on res.id = c.reservation_id
     where c.resolved_at is null
       and (p_org is null or c.organization_id = p_org)
  ) x
  order by 1, 5, 7;
end; $$;

revoke execute on function public.operon_ical_attention(uuid) from public, anon;
grant execute on function public.operon_ical_attention(uuid) to authenticated;
