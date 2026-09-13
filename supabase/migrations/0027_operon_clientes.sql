-- ============================================================
-- 0027 — Panel interno de Operon: listado de clientes
-- ============================================================
-- Un platform admin ya puede leer todas las organizaciones por RLS
-- (is_member_of incluye is_platform_admin), pero lo que hace falta para
-- saber si un cliente está vivo vive fuera del alcance de RLS: la última vez
-- que alguien del equipo entró (auth.users) y si conectó Mercado Pago
-- (app_private). Una sola RPC lo junta, con los conteos ya hechos en la base.
-- ============================================================

create or replace function operon_clients()
returns table (
  organization_id     uuid,
  name                text,
  slug                text,
  created_at          timestamptz,
  owner_email         text,
  owner_name          text,
  last_sign_in_at     timestamptz,
  members             int,
  units               int,
  reservations_total  int,
  reservations_month  int,
  last_reservation_at timestamptz,
  paid_month          numeric,
  currency            text,
  deposit_pct         numeric,
  mp_connected        boolean,
  mp_live             boolean,
  link_shared         boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  -- "Del mes" en la hora de Argentina, no en UTC: a las 22 h del último día
  -- del mes, UTC ya está en el mes siguiente.
  v_month_start date := date_trunc('month', now() at time zone 'America/Argentina/Cordoba')::date;
  v_month_end   date := (date_trunc('month', now() at time zone 'America/Argentina/Cordoba') + interval '1 month')::date;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  return query
  select
    o.id,
    o.name,
    o.slug,
    o.created_at,
    own.email,
    own.full_name,
    act.last_sign_in_at,
    coalesce(mem.n, 0),
    coalesce(un.n, 0),
    coalesce(res.total, 0),
    coalesce(res.in_month, 0),
    res.last_at,
    coalesce(pay.in_month, 0),
    coalesce(prop.currency, 'ARS'),
    coalesce(prop.deposit_pct, 0),
    mp.organization_id is not null,
    coalesce(mp.live_mode, false),
    o.link_shared_at is not null
  from public.organizations o
  left join lateral (
    select p.currency, p.deposit_pct
      from public.properties p
     where p.organization_id = o.id
     order by p.created_at
     limit 1
  ) prop on true
  left join lateral (
    select u.email::text as email, pr.full_name
      from public.memberships m
      join auth.users u on u.id = m.user_id
      left join public.profiles pr on pr.id = m.user_id
     where m.organization_id = o.id and m.role = 'owner'
     order by m.created_at
     limit 1
  ) own on true
  left join lateral (
    select max(u.last_sign_in_at) as last_sign_in_at
      from public.memberships m
      join auth.users u on u.id = m.user_id
     where m.organization_id = o.id
  ) act on true
  left join lateral (
    select count(*)::int as n from public.memberships m where m.organization_id = o.id
  ) mem on true
  left join lateral (
    select count(*)::int as n from public.units x where x.organization_id = o.id and x.is_active
  ) un on true
  left join lateral (
    select
      count(*)::int as total,
      (count(*) filter (
         where r.check_in >= v_month_start and r.check_in < v_month_end
           and r.status not in ('cancelled', 'expired', 'inquiry')
      ))::int as in_month,
      max(r.created_at) as last_at
      from public.reservations r
     where r.organization_id = o.id
  ) res on true
  left join lateral (
    select sum(pa.amount) as in_month
      from public.payments pa
     where pa.organization_id = o.id and pa.status = 'paid'
       and pa.paid_at >= v_month_start
  ) pay on true
  left join app_private.mp_credential mp on mp.organization_id = o.id
  order by o.created_at desc;
end $$;

revoke execute on function operon_clients() from public, anon;
grant execute on function operon_clients() to authenticated;
