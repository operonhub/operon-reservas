-- Edición compartida por localización. No relación con reservas ni datos de negocio.
create function public.zone_month_key(p_country text, p_city text) returns text
language sql immutable set search_path = '' as $$
  select case when upper(trim(p_country)) ~ '^[A-Z]{2}$'
    and length(trim(p_city)) between 1 and 100 and trim(p_city) ~ '^[[:alpha:] .''-]+$'
    then upper(trim(p_country)) || ':' || lower(regexp_replace(trim(p_city), '\s+', ' ', 'g')) end;
$$;
revoke all on function public.zone_month_key(text,text) from public, anon;
grant execute on function public.zone_month_key(text,text) to authenticated, service_role;

create table public.zone_month_editions (
  zone text not null,
  month date not null check (extract(day from month) = 1),
  status text not null default 'pending' check (status in ('pending','processing','failed','published')),
  attempts int not null default 0 check (attempts between 0 and 3),
  lease uuid,
  started_at timestamptz,
  retry_at timestamptz not null default now(),
  error_code text check (error_code in ('missing_key','quota','provider','invalid_output','invalid_sources','timeout','interrupted')),
  material jsonb,
  edition jsonb,
  model text,
  published_at timestamptz,
  primary key (zone, month),
  check ((status = 'published') = (edition is not null and published_at is not null)),
  check (status <> 'published' or (edition->>'zone' = zone and edition->>'month' = month::text and edition->>'version' = '1'))
);
alter table public.zone_month_editions enable row level security;
revoke all on public.zone_month_editions from anon, authenticated;
grant select on public.zone_month_editions to authenticated;
grant all on public.zone_month_editions to service_role;
create policy zone_month_read on public.zone_month_editions for select to authenticated using (
  exists (select 1 from public.properties p join public.memberships m on m.organization_id = p.organization_id
    where m.user_id = (select auth.uid()) and p.is_active
      and public.zone_month_key(p.country, p.city) = zone_month_editions.zone)
);
create index zone_month_work on public.zone_month_editions (month, retry_at) where status <> 'published';

-- Solo el worker puede encolar/reclamar. UTC: últimos siete días para el mes
-- siguiente; primeros siete para recuperación. Nunca acepta mes/zona del HTTP.
create function public.zone_month_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'UTC')::date; target date; r public.zone_month_editions;
begin
  -- Recuperar leases aunque la ventana de generación haya cerrado.
  update public.zone_month_editions set status = 'failed', error_code = 'interrupted', lease = null
  where status = 'processing' and started_at < now() - interval '5 minutes';

  if extract(day from d) <= 7 then target := date_trunc('month', d)::date;
  elsif d >= (date_trunc('month', d) + interval '1 month' - interval '7 days')::date then
    target := (date_trunc('month', d) + interval '1 month')::date;
  else return null; end if;

  insert into public.zone_month_editions(zone, month, retry_at)
  select distinct public.zone_month_key(p.country,p.city), target, now() from public.properties p
  where p.is_active and public.zone_month_key(p.country,p.city) is not null
    and exists (select 1 from public.memberships m where m.organization_id = p.organization_id)
  on conflict do nothing;

  select * into r from public.zone_month_editions e
  where e.month = target and e.status in ('pending','failed') and e.attempts < 3 and e.retry_at <= now()
  order by e.attempts, e.retry_at, e.zone for update skip locked limit 1;
  if not found then return null; end if;
  update public.zone_month_editions set status = 'processing', attempts = attempts + 1,
    started_at = now(), lease = gen_random_uuid(), error_code = null,
    retry_at = now() + interval '20 hours'
    where zone = r.zone and month = r.month returning * into r;
  return jsonb_build_object('zone',r.zone,'month',r.month,'lease',r.lease,'attempts',r.attempts);
end; $$;

-- Guarda la evidencia antes de contactar Gemini, sin exponer respuesta cruda.
create function public.zone_month_material(p_zone text, p_month date, p_lease uuid, p_material jsonb, p_model text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.zone_month_editions set material = p_material, model = p_model
  where zone = p_zone and month = p_month and lease = p_lease and status = 'processing';
  return found;
end; $$;

create function public.zone_month_finish(p_zone text, p_month date, p_lease uuid, p_edition jsonb, p_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (p_edition is null) = (p_error is null) then raise exception 'INVALID_RESULT'; end if;
  update public.zone_month_editions set
    status = case when p_error is null then 'published' else 'failed' end,
    error_code = p_error, edition = p_edition, lease = null,
    published_at = case when p_error is null then now() else null end
  where zone = p_zone and month = p_month and lease = p_lease and status = 'processing';
  return found;
end; $$;
revoke all on function public.zone_month_claim() from public, anon, authenticated;
revoke all on function public.zone_month_material(text,date,uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.zone_month_finish(text,date,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.zone_month_claim() to service_role;
grant execute on function public.zone_month_material(text,date,uuid,jsonb,text) to service_role;
grant execute on function public.zone_month_finish(text,date,uuid,jsonb,text) to service_role;
