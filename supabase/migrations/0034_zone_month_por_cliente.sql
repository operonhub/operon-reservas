-- ============================================================
-- 0034 — Tu zona este mes: activación por cliente desde el panel de Operon
-- ============================================================
-- Hasta 0032 las zonas que se generaban salían de una variable de entorno
-- (ZONE_MONTH_ALLOWED_ZONES) que había que editar en Vercel. Ahora se activa
-- por cliente desde /operon y las zonas salen de la base:
--   zonas habilitadas = ciudades de las propiedades activas de los clientes
--   habilitados, no suspendidos y con equipo. Tope de 10 zonas para cuidar la
--   cuota de Gemini.
--
-- ZONE_MONTH_ENABLED sigue siendo el interruptor general (cron y página).
--
-- Las ediciones siguen siendo por zona, no por cliente: reintentar desde la
-- ficha de un cliente afecta a todos los de esa ciudad, y desactivar uno no
-- frena la zona si otro cliente de la misma ciudad sigue activo.
--
-- zone_month_claim(text[]) se elimina: nunca corrió en producción y la
-- lista ya no viene del entorno.
-- ============================================================

create schema if not exists app_private;

alter table public.organizations add column if not exists zone_month_enabled_at timestamptz;

-- ---------- Zonas habilitadas ----------
create function app_private.zone_month_allowed_zones() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(z.zone order by z.first_enabled, z.zone), '{}'::text[])
  from (
    select public.zone_month_key(p.country, p.city) as zone, min(o.zone_month_enabled_at) as first_enabled
      from public.properties p
      join public.organizations o on o.id = p.organization_id
     where p.is_active
       and o.zone_month_enabled_at is not null
       and o.suspended_at is null
       and public.zone_month_key(p.country, p.city) is not null
       and exists (select 1 from public.memberships m where m.organization_id = o.id)
     group by 1
     order by 2, 1
     limit 10
  ) z;
$$;
revoke all on function app_private.zone_month_allowed_zones() from public, anon, authenticated;

-- ---------- Worker (service_role) ----------
-- El cron: misma lógica que 0032, con las zonas desde la base. Sin clientes
-- habilitados devuelve null (es lo normal, no un error).
create function public.zone_month_claim_enabled() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'UTC')::date; target date; r public.zone_month_editions; v_zones text[];
begin
  update public.zone_month_editions set status = 'failed', error_code = 'interrupted', lease = null
  where status = 'processing' and started_at < now() - interval '5 minutes';

  v_zones := app_private.zone_month_allowed_zones();
  if cardinality(v_zones) = 0 then return null; end if;

  if d < (date_trunc('month', d) + interval '1 month' - interval '5 days')::date then
    return null;
  end if;
  target := (date_trunc('month', d) + interval '1 month')::date;

  insert into public.zone_month_editions(zone, month, retry_at)
  select z, target, now() from unnest(v_zones) z
  on conflict do nothing;

  select * into r from public.zone_month_editions e
  where e.month = target and e.zone = any(v_zones)
    and e.status in ('pending','failed') and e.attempts < 3 and e.retry_at <= now()
  order by e.attempts, e.retry_at, e.zone for update skip locked limit 1;
  if not found then return null; end if;
  update public.zone_month_editions set status = 'processing', attempts = attempts + 1,
    started_at = now(), lease = gen_random_uuid(), error_code = null,
    retry_at = now() + interval '20 hours'
    where zone = r.zone and month = r.month returning * into r;
  return jsonb_build_object('zone',r.zone,'month',r.month,'lease',r.lease,'attempts',r.attempts);
end; $$;

-- "Generar ahora" desde el panel: reclama UNA edición puntual, fuera de la
-- ventana de cinco días. Solo zonas habilitadas y el mes actual o el próximo.
create function public.zone_month_claim_edition(p_zone text, p_month date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'UTC')::date; r public.zone_month_editions;
begin
  update public.zone_month_editions set status = 'failed', error_code = 'interrupted', lease = null
  where status = 'processing' and started_at < now() - interval '5 minutes';

  if not (p_zone = any(app_private.zone_month_allowed_zones())) then raise exception 'ZONE_NOT_ENABLED'; end if;
  if p_month not in (date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month')::date) then
    raise exception 'MONTH_OUT_OF_RANGE';
  end if;

  select * into r from public.zone_month_editions e
  where e.zone = p_zone and e.month = p_month
    and e.status in ('pending','failed') and e.attempts < 3
  for update skip locked;
  if not found then return null; end if;
  update public.zone_month_editions set status = 'processing', attempts = attempts + 1,
    started_at = now(), lease = gen_random_uuid(), error_code = null,
    retry_at = now() + interval '20 hours'
    where zone = r.zone and month = r.month returning * into r;
  return jsonb_build_object('zone',r.zone,'month',r.month,'lease',r.lease,'attempts',r.attempts);
end; $$;

drop function if exists public.zone_month_claim(text[]);
drop function if exists public.zone_month_claim();

revoke all on function public.zone_month_claim_enabled() from public, anon, authenticated;
revoke all on function public.zone_month_claim_edition(text, date) from public, anon, authenticated;
grant execute on function public.zone_month_claim_enabled() to service_role;
grant execute on function public.zone_month_claim_edition(text, date) to service_role;

-- ---------- Panel de Operon (platform admins) ----------
create function public.operon_set_zone_month(p_org uuid, p_enabled boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; v_count int;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_org from public.organizations where id = p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if (v_org.zone_month_enabled_at is not null) = p_enabled then return false; end if;

  if p_enabled then
    if v_org.suspended_at is not null then raise exception 'ORG_SUSPENDED'; end if;
    -- Zonas que quedarían activas si se suma este cliente.
    select count(distinct z) into v_count from (
      select unnest(app_private.zone_month_allowed_zones()) z
      union
      select public.zone_month_key(p.country, p.city) from public.properties p
       where p.organization_id = p_org and p.is_active
         and public.zone_month_key(p.country, p.city) is not null
    ) s;
    if v_count > 10 then raise exception 'ZONE_CAP'; end if;
  end if;

  update public.organizations
     set zone_month_enabled_at = case when p_enabled then now() else null end, updated_at = now()
   where id = p_org;
  perform app_private.log_admin_action(
    case when p_enabled then 'zone_month.enable' else 'zone_month.disable' end, p_org);
  return true;
end; $$;

-- Deja una edición lista para generarse ya: la crea si no existe, o le da un
-- intento más si falló (sin resetear el tope de tres).
create function public.operon_zone_month_queue(p_org uuid, p_zone text, p_month date) returns jsonb
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
  if r.status = 'published' then raise exception 'ALREADY_PUBLISHED'; end if;
  if r.status = 'processing' and r.started_at >= now() - interval '5 minutes' then
    raise exception 'ALREADY_RUNNING';
  end if;

  update public.zone_month_editions
     set status = 'pending', attempts = least(attempts, 2), retry_at = now(),
         error_code = null, lease = null, started_at = null
   where zone = p_zone and month = p_month;

  perform app_private.log_admin_action('zone_month.queue', p_org, null,
    jsonb_build_object('zone', p_zone, 'month', p_month,
                       'previous_status', r.status, 'previous_error', r.error_code));
  return jsonb_build_object('zone', p_zone, 'month', p_month, 'previous_status', r.status);
end; $$;

-- Estado de Tu zona por cliente: el listado (p_org null) y la ficha. Lee las
-- ediciones como definer: su RLS no incluye a los admins de Operon.
create function public.operon_zone_month_overview(p_org uuid default null)
returns table (organization_id uuid, enabled_at timestamptz, missing_location boolean, zones jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  d date := (now() at time zone 'UTC')::date;
  v_current date := date_trunc('month', d)::date;
  v_next date := (date_trunc('month', d) + interval '1 month')::date;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  return query
  select
    o.id,
    o.zone_month_enabled_at,
    not exists (select 1 from public.properties p where p.organization_id = o.id and p.is_active)
      or exists (select 1 from public.properties p
                  where p.organization_id = o.id and p.is_active
                    and public.zone_month_key(p.country, p.city) is null),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'zone', z.zone,
               'current', (select jsonb_build_object('status', e.status, 'attempts', e.attempts,
                                    'error_code', e.error_code, 'published_at', e.published_at,
                                    'started_at', e.started_at)
                             from public.zone_month_editions e where e.zone = z.zone and e.month = v_current),
               'next', (select jsonb_build_object('status', e.status, 'attempts', e.attempts,
                                 'error_code', e.error_code, 'published_at', e.published_at,
                                 'started_at', e.started_at)
                          from public.zone_month_editions e where e.zone = z.zone and e.month = v_next)
             ) order by z.zone)
        from (select distinct public.zone_month_key(p.country, p.city) as zone
                from public.properties p
               where p.organization_id = o.id and p.is_active
                 and public.zone_month_key(p.country, p.city) is not null) z
    ), '[]'::jsonb)
  from public.organizations o
  where p_org is null or o.id = p_org;
end; $$;

revoke execute on function public.operon_set_zone_month(uuid, boolean) from public, anon;
revoke execute on function public.operon_zone_month_queue(uuid, text, date) from public, anon;
revoke execute on function public.operon_zone_month_overview(uuid) from public, anon;
grant execute on function public.operon_set_zone_month(uuid, boolean) to authenticated;
grant execute on function public.operon_zone_month_queue(uuid, text, date) to authenticated;
grant execute on function public.operon_zone_month_overview(uuid) to authenticated;
