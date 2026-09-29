-- Mantener la migración 0030 intacta: ya fue aplicada en el piloto local.
-- El cron diario genera la edición siguiente sólo en los últimos cinco días UTC.
create or replace function public.zone_month_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'UTC')::date; target date; r public.zone_month_editions;
begin
  -- Recuperar leases vencidos incluso después de cerrar la ventana.
  update public.zone_month_editions set status = 'failed', error_code = 'interrupted', lease = null
  where status = 'processing' and started_at < now() - interval '5 minutes';

  if d < (date_trunc('month', d) + interval '1 month' - interval '5 days')::date then
    return null;
  end if;
  target := (date_trunc('month', d) + interval '1 month')::date;

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
