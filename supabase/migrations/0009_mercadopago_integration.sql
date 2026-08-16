-- ============================================================
-- Operon Reservas — Integración Mercado Pago (OAuth por organización)
-- ============================================================
-- Cada organización conecta SU PROPIA cuenta de Mercado Pago vía OAuth.
-- El dinero va 100% a la cuenta de la cabaña: Operon nunca es intermediario
-- financiero ni retiene fondos.
--
-- Los tokens de MP mueven dinero → son secretos de máxima sensibilidad.
-- Viven en el schema app_private, con RLS y REVOKE a todos los roles.
-- Sólo se acceden mediante funciones SECURITY DEFINER acotadas:
--   * El panel (authenticated) escribe/lee ESTADO, nunca los tokens.
--   * El servidor (service_role) obtiene los tokens para crear pagos.
-- El navegador jamás ve un access_token.
-- ============================================================

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ---------- Handshake OAuth (protección CSRF + PKCE) ----------
create table app_private.mp_oauth_state (
  state           text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  code_verifier   text not null,                 -- PKCE: se guarda para el intercambio
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '15 minutes')
);
alter table app_private.mp_oauth_state enable row level security;
revoke all on app_private.mp_oauth_state from public, anon, authenticated;

-- ---------- Credenciales de MP por organización (SECRETO) ----------
create table app_private.mp_credential (
  organization_id uuid primary key references organizations(id) on delete cascade,
  mp_user_id      text not null,                 -- id del vendedor (cuenta MP de la cabaña)
  access_token    text not null,
  refresh_token   text not null,
  public_key      text,
  live_mode       boolean not null default false,-- true = credenciales productivas
  scopes          text,
  expires_at      timestamptz not null,          -- vencimiento del access_token (~180 días)
  connected_by    uuid references auth.users(id),
  connected_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table app_private.mp_credential enable row level security;
revoke all on app_private.mp_credential from public, anon, authenticated;

create trigger mp_credential_set_updated_at
  before update on app_private.mp_credential
  for each row execute function public.set_updated_at();

-- ============================================================
-- Helpers de contexto
-- ============================================================

-- Organización que administra el usuario del panel (misma lógica que
-- requireContext: primera membership). Devuelve org sólo si el rol la gestiona.
create or replace function _mp_admin_org()
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_role text;
begin
  select m.organization_id, m.role into v_org, v_role
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;

  if v_org is null then raise exception 'NO_MEMBERSHIP'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'FORBIDDEN'; end if;
  return v_org;
end;
$$;

-- Igual pero sin exigir rol admin: cualquier miembro puede VER el estado.
create or replace function _mp_member_org()
returns uuid
language sql stable security definer set search_path = '' as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;
$$;

-- ============================================================
-- RPCs del panel (authenticated) — nunca exponen tokens
-- ============================================================

-- Guarda el state + code_verifier del handshake. La org se DERIVA de la
-- membership (no se confía en el cliente).
create or replace function mp_save_oauth_state(p_state text, p_code_verifier text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  v_org := public._mp_admin_org();

  delete from app_private.mp_oauth_state where expires_at < now();

  insert into app_private.mp_oauth_state (state, organization_id, code_verifier, created_by)
  values (p_state, v_org, p_code_verifier, auth.uid());

  return v_org;
end;
$$;

-- Valida y consume (borra) el state. Devuelve org + code_verifier para el
-- intercambio del code. Falla si no es del usuario, no existe o expiró.
create or replace function mp_consume_oauth_state(p_state text)
returns table (organization_id uuid, code_verifier text)
language plpgsql security definer set search_path = '' as $$
declare v_admin_org uuid;
begin
  v_admin_org := public._mp_admin_org();

  return query
  delete from app_private.mp_oauth_state s
  where s.state = p_state
    and s.organization_id = v_admin_org
    and s.expires_at >= now()
  returning s.organization_id, s.code_verifier;

  if not found then raise exception 'INVALID_OAUTH_STATE'; end if;
end;
$$;

-- Persiste las credenciales tras el intercambio del code. Revalida que el
-- usuario administre la org antes de escribir el secreto.
create or replace function mp_store_credential(
  p_organization_id uuid,
  p_mp_user_id text,
  p_access_token text,
  p_refresh_token text,
  p_public_key text,
  p_live_mode boolean,
  p_scopes text,
  p_expires_in int
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_organization_id <> public._mp_admin_org() then
    raise exception 'FORBIDDEN';
  end if;

  insert into app_private.mp_credential (
    organization_id, mp_user_id, access_token, refresh_token, public_key,
    live_mode, scopes, expires_at, connected_by, connected_at, updated_at
  ) values (
    p_organization_id, p_mp_user_id, p_access_token, p_refresh_token, p_public_key,
    coalesce(p_live_mode, false), p_scopes,
    now() + make_interval(secs => greatest(coalesce(p_expires_in, 0), 0)),
    auth.uid(), now(), now()
  )
  on conflict (organization_id) do update set
    mp_user_id    = excluded.mp_user_id,
    access_token  = excluded.access_token,
    refresh_token = excluded.refresh_token,
    public_key    = excluded.public_key,
    live_mode     = excluded.live_mode,
    scopes        = excluded.scopes,
    expires_at    = excluded.expires_at,
    connected_by  = excluded.connected_by,
    connected_at  = now(),
    updated_at    = now();
end;
$$;

-- Estado de conexión para el panel. SIN tokens.
create or replace function mp_connection_status()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_row app_private.mp_credential;
begin
  v_org := public._mp_member_org();
  if v_org is null then raise exception 'NO_MEMBERSHIP'; end if;

  select * into v_row from app_private.mp_credential where organization_id = v_org;

  if not found then
    return jsonb_build_object('connected', false);
  end if;

  return jsonb_build_object(
    'connected', true,
    'mp_user_id', v_row.mp_user_id,
    'live_mode', v_row.live_mode,
    'connected_at', v_row.connected_at,
    'expires_at', v_row.expires_at
  );
end;
$$;

-- Desconecta la cuenta (borra credenciales). Sólo owner/admin.
create or replace function mp_disconnect()
returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  v_org := public._mp_admin_org();
  delete from app_private.mp_credential where organization_id = v_org;
end;
$$;

-- ============================================================
-- RPCs de servidor (service_role) — devuelven tokens al backend confiable
-- Usadas por /api/mp/checkout, /api/mp/webhook y el refresco de tokens.
-- NUNCA accesibles por anon/authenticated.
-- ============================================================

create or replace function mp_service_get_credential(p_organization_id uuid)
returns app_private.mp_credential
language sql stable security definer set search_path = '' as $$
  select * from app_private.mp_credential where organization_id = p_organization_id;
$$;

create or replace function mp_service_get_credential_by_mp_user(p_mp_user_id text)
returns app_private.mp_credential
language sql stable security definer set search_path = '' as $$
  select * from app_private.mp_credential where mp_user_id = p_mp_user_id limit 1;
$$;

create or replace function mp_service_update_tokens(
  p_organization_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_in int
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.mp_credential
     set access_token  = p_access_token,
         refresh_token = coalesce(p_refresh_token, refresh_token),
         expires_at    = now() + make_interval(secs => greatest(coalesce(p_expires_in, 0), 0)),
         updated_at    = now()
   where organization_id = p_organization_id;
end;
$$;

-- ============================================================
-- Permisos: por defecto revocar, luego otorgar lo mínimo
-- ============================================================
revoke execute on function _mp_admin_org() from public, anon, authenticated;
revoke execute on function _mp_member_org() from public, anon, authenticated;

revoke execute on function mp_save_oauth_state(text,text) from public, anon;
revoke execute on function mp_consume_oauth_state(text) from public, anon;
revoke execute on function mp_store_credential(uuid,text,text,text,text,boolean,text,int) from public, anon;
revoke execute on function mp_connection_status() from public, anon;
revoke execute on function mp_disconnect() from public, anon;

grant execute on function mp_save_oauth_state(text,text) to authenticated;
grant execute on function mp_consume_oauth_state(text) to authenticated;
grant execute on function mp_store_credential(uuid,text,text,text,text,boolean,text,int) to authenticated;
grant execute on function mp_connection_status() to authenticated;
grant execute on function mp_disconnect() to authenticated;

-- Getters con tokens: sólo el backend confiable.
revoke execute on function mp_service_get_credential(uuid) from public, anon, authenticated;
revoke execute on function mp_service_get_credential_by_mp_user(text) from public, anon, authenticated;
revoke execute on function mp_service_update_tokens(uuid,text,text,int) from public, anon, authenticated;

grant execute on function mp_service_get_credential(uuid) to service_role;
grant execute on function mp_service_get_credential_by_mp_user(text) to service_role;
grant execute on function mp_service_update_tokens(uuid,text,text,int) to service_role;
