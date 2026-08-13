-- ============================================================
-- Operon Reservas — RLS y aislamiento multi-tenant
-- ============================================================
-- Regla: un usuario solo accede a filas de las organizaciones donde
-- tiene membership. anon NO accede a ninguna tabla directamente; el
-- acceso público va exclusivamente por RPC SECURITY DEFINER (0003).
-- ============================================================

-- ---------- Helpers (SECURITY DEFINER: corren como owner y no gatillan RLS,
--            así evitamos recursión al leer memberships desde las políticas) ----------

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function is_member_of(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.organization_id = org
  ) or public.is_platform_admin();
$$;

create or replace function shares_org(target_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and them.user_id = target_user
  );
$$;

grant execute on function public.is_platform_admin()      to authenticated;
grant execute on function public.is_member_of(uuid)       to authenticated;
grant execute on function public.shares_org(uuid)         to authenticated;

-- ---------- Habilitar RLS en todo ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','organizations','memberships','platform_admins',
                           'properties','units','rates','guests','reservations',
                           'unit_occupancy','payments'] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- profiles: propio + co-miembros de org + superadmin ----------
create policy profiles_select on profiles for select to authenticated
  using ( id = auth.uid() or public.is_platform_admin() or public.shares_org(id) );
create policy profiles_update_self on profiles for update to authenticated
  using ( id = auth.uid() ) with check ( id = auth.uid() );

-- ---------- organizations: la org ES el tenant (sin columna organization_id) ----------
create policy organizations_rw on organizations for all to authenticated
  using ( public.is_member_of(id) )
  with check ( public.is_member_of(id) );

-- ---------- memberships: visibles dentro de la propia org ----------
create policy memberships_select on memberships for select to authenticated
  using ( public.is_member_of(organization_id) );
-- (altas/bajas de miembros se gestionan por service role / superadmin en Etapa 1)

-- ---------- platform_admins: solo superadmin ----------
create policy platform_admins_select on platform_admins for select to authenticated
  using ( public.is_platform_admin() );

-- ---------- Tablas tenant con organization_id: RW acotado a la org ----------
do $$
declare t text;
begin
  foreach t in array array['properties','units','rates','guests',
                           'reservations','unit_occupancy','payments'] loop
    execute format($p$
      create policy %1$s_rw on public.%1$s for all to authenticated
        using ( public.is_member_of(organization_id) )
        with check ( public.is_member_of(organization_id) );
    $p$, t);
  end loop;
end $$;
