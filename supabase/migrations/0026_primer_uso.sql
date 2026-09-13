-- ============================================================
-- 0026 — Primer uso: invitaciones, asistente de configuración,
-- tour guiado y lista de primeros pasos.
-- ============================================================
-- Nada se escribe en las tablas del tenant hasta el último paso del
-- asistente. Canjear una invitación da un permiso de alta (setup_grant) con
-- un borrador; complete_setup crea organización, membresía owner, propiedad,
-- unidades y tarifas base en una sola transacción. Por eso no existe una
-- organización "a medio configurar" y el panel no necesita otro gate.
-- ============================================================

create schema if not exists app_private;

-- ---------- Invitaciones ----------
-- Solo se guarda el hash del token: quien lea la tabla no puede usar un link.
create table if not exists app_private.invitations (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email       text,
  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz
);
alter table app_private.invitations enable row level security;
revoke all on app_private.invitations from public, anon, authenticated;

create table if not exists app_private.setup_grants (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  invitation_id    uuid references app_private.invitations(id) on delete set null,
  draft            jsonb not null default '{}'::jsonb,
  draft_updated_at timestamptz,
  created_at       timestamptz not null default now(),
  consumed_at      timestamptz,
  organization_id  uuid references public.organizations(id) on delete set null
);
alter table app_private.setup_grants enable row level security;
revoke all on app_private.setup_grants from public, anon, authenticated;

-- ---------- Estado del tour y de la lista de primeros pasos ----------
alter table public.profiles      add column if not exists tour_completed_at      timestamptz;
alter table public.organizations add column if not exists link_shared_at         timestamptz;
alter table public.organizations add column if not exists checklist_dismissed_at timestamptz;

-- ---------- Helpers internos ----------
create or replace function app_private.invitation_status(i app_private.invitations)
returns text language sql stable set search_path = '' as $$
  select case
    when i.revoked_at  is not null then 'revoked'
    when i.redeemed_at is not null then 'used'
    when i.expires_at <= now()     then 'expired'
    else 'valid'
  end
$$;

-- Misma regla que src/lib/slug.ts. Los reservados chocan con rutas propias o
-- se prestan a confundir al huésped.
create or replace function app_private.slug_is_valid(p_slug text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_slug, '') ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'
     and p_slug !~ '--'
     and p_slug <> all (array[
       'admin', 'api', 'app', 'ayuda', 'bienvenida', 'demo', 'ical', 'invitacion',
       'login', 'operon', 'pago', 'panel', 'reservar', 'sin-acceso', 'soporte', 'www'
     ])
$$;

revoke all on function app_private.invitation_status(app_private.invitations) from public;
revoke all on function app_private.slug_is_valid(text) from public;

-- ============================================================
-- Invitaciones — página interna (solo platform admins)
-- ============================================================
create or replace function invitation_create(p_token_hash text, p_email text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_TOKEN'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  insert into app_private.invitations (token_hash, email, note, created_by)
  values (p_token_hash, v_email, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function invitation_list()
returns table (
  id uuid, email text, note text, created_at timestamptz, expires_at timestamptz,
  status text, redeemed_at timestamptz, redeemed_email text, organization_name text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  return query
    select i.id, i.email, i.note, i.created_at, i.expires_at,
           app_private.invitation_status(i), i.redeemed_at, u.email::text, o.name
      from app_private.invitations i
      left join auth.users u on u.id = i.redeemed_by
      left join app_private.setup_grants g on g.invitation_id = i.id
      left join public.organizations o on o.id = g.organization_id
     order by i.created_at desc
     limit 200;
end $$;

create or replace function invitation_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  update app_private.invitations
     set revoked_at = now()
   where id = p_id and redeemed_at is null and revoked_at is null;
  return found;
end $$;

-- ============================================================
-- Invitaciones — registro (service role, desde server actions)
-- ============================================================
create or replace function invitation_lookup(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_inv app_private.invitations;
begin
  select * into v_inv from app_private.invitations where token_hash = p_token_hash;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object(
    'status', app_private.invitation_status(v_inv),
    'email', v_inv.email,
    'redeemed_by', v_inv.redeemed_by
  );
end $$;

-- Devuelve {ok, reason} en vez de lanzar: cada motivo tiene su pantalla.
create or replace function invitation_redeem(p_token_hash text, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv app_private.invitations; v_status text; v_email text;
begin
  select * into v_inv from app_private.invitations where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- Reintento del mismo usuario (doble submit, refresco): no es un error.
  if v_inv.redeemed_by = p_user_id and v_inv.revoked_at is null then
    return jsonb_build_object('ok', true);
  end if;

  v_status := app_private.invitation_status(v_inv);
  if v_status <> 'valid' then return jsonb_build_object('ok', false, 'reason', v_status); end if;

  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'user_not_found'); end if;
  if v_inv.email is not null and v_inv.email is distinct from v_email then
    return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
  end if;
  if exists (select 1 from public.memberships m where m.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;
  if exists (select 1 from app_private.setup_grants g where g.user_id = p_user_id and g.consumed_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'already_has_grant');
  end if;

  update app_private.invitations set redeemed_at = now(), redeemed_by = p_user_id where id = v_inv.id;
  insert into app_private.setup_grants (user_id, invitation_id)
  values (p_user_id, v_inv.id)
  on conflict (user_id) do update
    set invitation_id = excluded.invitation_id, draft = '{}'::jsonb, draft_updated_at = null,
        created_at = now(), consumed_at = null, organization_id = null;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- Asistente de configuración (usuario autenticado con permiso de alta)
-- ============================================================
create or replace function my_onboarding_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_draft jsonb;
begin
  select g.draft into v_draft
    from app_private.setup_grants g
   where g.user_id = auth.uid() and g.consumed_at is null;
  if not found then return jsonb_build_object('has_grant', false); end if;
  return jsonb_build_object('has_grant', true, 'draft', v_draft);
end $$;

create or replace function setup_save_draft(p_draft jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if coalesce(jsonb_typeof(p_draft), '') <> 'object' or octet_length(p_draft::text) > 16384 then
    raise exception 'INVALID_DRAFT';
  end if;
  if not public.rate_limit_hit('setup_draft', auth.uid()::text, 300, 3600) then
    raise exception 'RATE_LIMITED';
  end if;
  update app_private.setup_grants
     set draft = p_draft, draft_updated_at = now()
   where user_id = auth.uid() and consumed_at is null;
  if not found then raise exception 'NO_GRANT'; end if;
end $$;

create or replace function setup_slug_available(p_slug text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from app_private.setup_grants g where g.user_id = auth.uid() and g.consumed_at is null
  ) then
    raise exception 'NO_GRANT';
  end if;
  if not public.rate_limit_hit('setup_slug', auth.uid()::text, 120, 3600) then
    raise exception 'RATE_LIMITED';
  end if;
  return app_private.slug_is_valid(p_slug)
     and not exists (select 1 from public.organizations o where o.slug = p_slug);
end $$;

-- payload: { name, slug, city?, currency, timezone, checkin_time, checkout_time,
--            units: [{ name, capacity, price }] }
create or replace function complete_setup(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_name      text := trim(coalesce(p_payload->>'name', ''));
  v_slug      text := lower(trim(coalesce(p_payload->>'slug', '')));
  v_city      text := nullif(trim(coalesce(p_payload->>'city', '')), '');
  v_currency  text := upper(trim(coalesce(p_payload->>'currency', 'ARS')));
  v_tz        text := coalesce(nullif(p_payload->>'timezone', ''), 'America/Argentina/Cordoba');
  v_units     jsonb := p_payload->'units';
  v_checkin   time;
  v_checkout  time;
  v_unit      jsonb;
  v_unit_name text;
  v_capacity  int;
  v_price     numeric;
  v_names     text[] := '{}';
  v_position  int := 0;
  v_org       uuid;
  v_prop      uuid;
  v_unit_id   uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Un doble click manda dos llamadas: la segunda espera acá y encuentra el
  -- permiso ya consumido.
  perform pg_advisory_xact_lock(hashtext('complete_setup:' || v_uid::text));

  if not exists (
    select 1 from app_private.setup_grants g where g.user_id = v_uid and g.consumed_at is null
  ) then
    raise exception 'NO_GRANT';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    raise exception 'ALREADY_MEMBER';
  end if;

  if char_length(v_name) not between 2 and 80 then raise exception 'INVALID_NAME'; end if;
  if not app_private.slug_is_valid(v_slug) then raise exception 'INVALID_SLUG'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
  if v_city is not null and char_length(v_city) > 80 then raise exception 'INVALID_CITY'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = v_tz) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  begin
    v_checkin  := coalesce(nullif(p_payload->>'checkin_time', ''), '14:00')::time;
    v_checkout := coalesce(nullif(p_payload->>'checkout_time', ''), '10:00')::time;
  exception when others then
    raise exception 'INVALID_TIME';
  end;

  if coalesce(jsonb_typeof(v_units), '') <> 'array' or jsonb_array_length(v_units) not between 1 and 30 then
    raise exception 'INVALID_UNITS';
  end if;

  begin
    insert into public.organizations (name, slug) values (v_name, v_slug) returning id into v_org;
  exception when unique_violation then
    raise exception 'SLUG_TAKEN';
  end;

  insert into public.memberships (organization_id, user_id, role) values (v_org, v_uid, 'owner');

  insert into public.properties (organization_id, name, slug, city, currency, timezone, checkin_time, checkout_time)
  values (v_org, v_name, v_slug, v_city, v_currency, v_tz, v_checkin, v_checkout)
  returning id into v_prop;

  for v_unit in select value from jsonb_array_elements(v_units) loop
    v_unit_name := trim(coalesce(v_unit->>'name', ''));
    if char_length(v_unit_name) not between 1 and 60 then raise exception 'INVALID_UNIT_NAME'; end if;
    if lower(v_unit_name) = any (v_names) then raise exception 'DUPLICATE_UNIT_NAME'; end if;
    v_names := v_names || lower(v_unit_name);

    begin
      v_capacity := (v_unit->>'capacity')::int;
      v_price    := (v_unit->>'price')::numeric;
    exception when others then
      raise exception 'INVALID_UNIT';
    end;
    if v_capacity is null or v_capacity not between 1 and 50 then raise exception 'INVALID_CAPACITY'; end if;
    if v_price is null or v_price <= 0 or v_price >= 10000000000 or v_price <> round(v_price, 2) then
      raise exception 'INVALID_PRICE';
    end if;

    insert into public.units (organization_id, property_id, name, capacity, position)
    values (v_org, v_prop, v_unit_name, v_capacity, v_position)
    returning id into v_unit_id;

    insert into public.rates (organization_id, property_id, unit_id, kind, label, price_per_night, currency, min_nights, is_active)
    values (v_org, v_prop, v_unit_id, 'base', 'Tarifa base', v_price, v_currency, 1, true);

    v_position := v_position + 1;
  end loop;

  update app_private.setup_grants
     set consumed_at = now(), organization_id = v_org, draft = '{}'::jsonb
   where user_id = v_uid;

  return v_org;
end $$;

-- ============================================================
-- Tour y primeros pasos
-- ============================================================
create or replace function mark_tour_completed()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set tour_completed_at = coalesce(tour_completed_at, now()) where id = auth.uid();
$$;

-- Compartir el link es algo que hace cualquier miembro; ocultar la lista
-- cambia lo que ve todo el equipo, así que queda para owner/admin.
create or replace function org_onboarding_mark(p_org uuid, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_event = 'link_shared' then
    if not public.is_member_of(p_org) then raise exception 'FORBIDDEN'; end if;
    update public.organizations set link_shared_at = coalesce(link_shared_at, now()) where id = p_org;
  elsif p_event = 'checklist_dismissed' then
    if not public.is_admin_of(p_org) then raise exception 'FORBIDDEN'; end if;
    update public.organizations set checklist_dismissed_at = coalesce(checklist_dismissed_at, now()) where id = p_org;
  else
    raise exception 'INVALID_EVENT';
  end if;
end $$;

-- ============================================================
-- Permisos
-- ============================================================
revoke execute on function invitation_create(text, text, text)  from public, anon;
revoke execute on function invitation_list()                    from public, anon;
revoke execute on function invitation_revoke(uuid)              from public, anon;
revoke execute on function invitation_lookup(text)              from public, anon, authenticated;
revoke execute on function invitation_redeem(text, uuid)        from public, anon, authenticated;
revoke execute on function my_onboarding_status()               from public, anon;
revoke execute on function setup_save_draft(jsonb)              from public, anon;
revoke execute on function setup_slug_available(text)           from public, anon;
revoke execute on function complete_setup(jsonb)                from public, anon;
revoke execute on function mark_tour_completed()                from public, anon;
revoke execute on function org_onboarding_mark(uuid, text)      from public, anon;

grant execute on function invitation_create(text, text, text)   to authenticated;
grant execute on function invitation_list()                     to authenticated;
grant execute on function invitation_revoke(uuid)               to authenticated;
grant execute on function invitation_lookup(text)               to service_role;
grant execute on function invitation_redeem(text, uuid)         to service_role;
grant execute on function my_onboarding_status()                to authenticated;
grant execute on function setup_save_draft(jsonb)               to authenticated;
grant execute on function setup_slug_available(text)            to authenticated;
grant execute on function complete_setup(jsonb)                 to authenticated;
grant execute on function mark_tour_completed()                 to authenticated;
grant execute on function org_onboarding_mark(uuid, text)       to authenticated;
