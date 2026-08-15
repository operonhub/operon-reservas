-- ============================================================
-- Operon Reservas — Cobros con Mercado Pago (preferencias + webhook)
-- ============================================================
-- El cobro se hace desde el backend confiable (service_role): lee la
-- credencial de la org, crea la preferencia en MP y registra el pago.
-- Reservas y payments son tablas public → el service_role las opera directo
-- (saltea RLS). Acá sólo agregamos tracking de MP y un flag público.
-- ============================================================

-- Tracking de la preferencia de Checkout Pro sobre el pago.
alter table payments add column if not exists mp_preference_id text;
alter table payments add column if not exists mp_init_point text;

-- ---------- Flag público: ¿la org cobra online? ----------
-- Devuelve sólo un booleano (sin tokens) para que la web pública muestre u
-- oculte el botón de pago. Resuelve la org por su slug.
create or replace function mp_public_status(p_org_slug text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_enabled boolean;
begin
  select id into v_org from public.organizations where slug = p_org_slug;
  if v_org is null then
    return jsonb_build_object('enabled', false);
  end if;

  select exists (
    select 1 from app_private.mp_credential where organization_id = v_org
  ) into v_enabled;

  return jsonb_build_object('enabled', coalesce(v_enabled, false));
end;
$$;

revoke execute on function mp_public_status(text) from public;
grant execute on function mp_public_status(text) to anon, authenticated;
