-- ============================================================
-- 0037 — Tu zona este mes v2: investigación real del destino
-- ============================================================
-- La edición v1 era un catálogo fijo de consejos que Gemini ordenaba. La v2 la
-- redacta Claude con búsquedas web y fuentes citadas (src/lib/zone-month/
-- research.ts). La tabla pasa a aceptar ediciones versión 2 (las v1
-- publicadas se siguen mostrando).
--
-- Además:
-- - Desde /operon se puede volver a generar una edición ya publicada (antes
--   era irreversible): la anterior deja de verse hasta que salga la nueva.
-- - La pregunta final del informe se contesta: zone_month_feedback guarda,
--   por complejo y mes, qué quiere profundizar el dueño y qué ideas marcó
--   como hechas. La investigación del mes siguiente recibe solo la cuenta
--   agregada de intereses de la zona (zone_month_interests), nunca quién.
-- ============================================================

alter table public.zone_month_editions drop constraint zone_month_editions_check1;
alter table public.zone_month_editions add constraint zone_month_editions_published_shape check (
  status <> 'published' or (
    edition->>'zone' = zone and edition->>'month' = month::text and edition->>'version' in ('1', '2')
  )
);

-- Copia exacta de 0034 (verificada contra producción) salvo el caso publicado:
-- en vez de rechazarlo, la deja pendiente con los tres intentos de nuevo.
create or replace function public.operon_zone_month_queue(p_org uuid, p_zone text, p_month date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; d date := (now() at time zone 'UTC')::date; r public.zone_month_editions;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_org from public.organizations where id = p_org;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if v_org.suspended_at is not null then raise exception 'ORG_SUSPENDED'; end if;
  if v_org.zone_month_enabled_at is null then raise exception 'ZONE_NOT_ENABLED'; end if;
  if not exists (select 1 from public.properties p
                  where p.organization_id = p_org and p.is_active
                    and public.zone_month_key(p.country, p.city) = p_zone) then
    raise exception 'ZONE_NOT_IN_ORG';
  end if;
  if p_month not in (date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month')::date) then
    raise exception 'MONTH_OUT_OF_RANGE';
  end if;

  insert into public.zone_month_editions(zone, month, retry_at) values (p_zone, p_month, now())
  on conflict do nothing;

  select * into r from public.zone_month_editions where zone = p_zone and month = p_month for update;
  if r.status = 'processing' and r.started_at >= now() - interval '5 minutes' then
    raise exception 'ALREADY_RUNNING';
  end if;

  update public.zone_month_editions
     set status = 'pending',
         attempts = case when r.status = 'published' then 0 else least(attempts, 2) end,
         retry_at = now(), error_code = null, lease = null, started_at = null,
         edition = null, published_at = null
   where zone = p_zone and month = p_month;

  perform app_private.log_admin_action('zone_month.queue', p_org, null,
    jsonb_build_object('zone', p_zone, 'month', p_month,
                       'previous_status', r.status, 'previous_error', r.error_code));
  return jsonb_build_object('zone', p_zone, 'month', p_month, 'previous_status', r.status);
end; $$;

-- ---------- Respuestas del dueño ----------
create table public.zone_month_feedback (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  interests text[] not null default '{}'
    check (interests <@ array['tarifas', 'reservas', 'turismo', 'gestion']::text[]),
  done text[] not null default '{}' check (cardinality(done) <= 20),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, month)
);
alter table public.zone_month_feedback enable row level security;
revoke all on public.zone_month_feedback from anon, authenticated;
grant select on public.zone_month_feedback to authenticated;
grant all on public.zone_month_feedback to service_role;
create policy zone_month_feedback_read on public.zone_month_feedback for select to authenticated
  using (public.is_member_of(organization_id));

create function public.zone_month_save_feedback(p_org uuid, p_month date, p_interests text[], p_done text[])
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_interests text[]; v_done text[];
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.is_member_of(p_org) then raise exception 'FORBIDDEN'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'INVALID_MONTH'; end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_interests from unnest(coalesce(p_interests, '{}')) x;
  select coalesce(array_agg(distinct x order by x), '{}') into v_done from unnest(coalesce(p_done, '{}')) x;
  if not v_interests <@ array['tarifas', 'reservas', 'turismo', 'gestion']::text[] then raise exception 'INVALID_INTERESTS'; end if;
  if cardinality(v_done) > 20 or exists (select 1 from unnest(v_done) x where x !~ '^[a-z0-9-]{1,40}$') then
    raise exception 'INVALID_DONE';
  end if;

  insert into public.zone_month_feedback(organization_id, month, interests, done, updated_by, updated_at)
  values (p_org, p_month, v_interests, v_done, auth.uid(), now())
  on conflict (organization_id, month) do update
    set interests = excluded.interests, done = excluded.done,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return true;
end; $$;
revoke all on function public.zone_month_save_feedback(uuid, date, text[], text[]) from public, anon;
grant execute on function public.zone_month_save_feedback(uuid, date, text[], text[]) to authenticated;

-- Intereses del mes anterior de los complejos de la zona: solo la cuenta por tema.
create function public.zone_month_interests(p_zone text, p_month date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(interest, n), '{}'::jsonb) from (
    select i.interest, count(distinct f.organization_id)::int as n
      from public.zone_month_feedback f
      cross join lateral unnest(f.interests) as i(interest)
     where f.month = (p_month - interval '1 month')::date
       and exists (select 1 from public.properties p
                    where p.organization_id = f.organization_id and p.is_active
                      and public.zone_month_key(p.country, p.city) = p_zone)
     group by i.interest
  ) t;
$$;
revoke all on function public.zone_month_interests(text, date) from public, anon, authenticated;
grant execute on function public.zone_month_interests(text, date) to service_role;
