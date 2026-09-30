-- ============================================================
-- 0033 — Panel interno de Operon: control de clientes
-- ============================================================
-- El panel /operon pasa de un listado a una herramienta de administración:
--   * suspender / reactivar un complejo (reversible, con motivo),
--   * ficha por cliente (equipo, alojamiento, uso, salud de mails),
--   * soporte de cuentas (quitar un miembro, link de nueva contraseña),
--   * registro de acciones de los admins, escrito DENTRO de cada RPC para
--     que no se pueda saltear.
--
-- Privacidad: lo que es plata del cliente (cobros, totales, señas, tarifas)
-- no sale de ninguna RPC de este panel. Se decidió ocultarlo a nivel panel:
-- el bypass de is_platform_admin() en is_member_of/is_admin_of se mantiene.
--
-- Suspensión: corta las altas nuevas desde la página pública (todo pasa por
-- _resolve_property) y la importación de calendarios. A propósito NO corta
-- /pago (public_reservation_status), el checkout/webhook de Mercado Pago ni
-- el feed iCal exportado: si el feed se vaciara, Airbnb/Booking reabrirían
-- fechas que siguen reservadas acá.
-- ============================================================

create schema if not exists app_private;

-- ---------- Estado de la organización ----------
-- El motivo NO va en organizations: los miembros leen su propia fila por RLS.
-- Vive solo en el registro de acciones.
alter table public.organizations add column if not exists suspended_at timestamptz;

-- ---------- Registro de acciones de los admins ----------
create table app_private.admin_audit_log (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  actor_id        uuid references auth.users(id) on delete set null,
  actor_email     text,
  action          text not null check (action in (
    'org.suspend', 'org.reactivate',
    'member.remove', 'member.recovery_link',
    'invitation.create', 'invitation.revoke',
    'zone_month.enable', 'zone_month.disable', 'zone_month.queue'
  )),
  organization_id uuid references public.organizations(id) on delete set null,
  target_user_id  uuid,
  target_email    text,
  detail          jsonb not null default '{}'::jsonb,
  reason          text check (reason is null or length(reason) <= 500)
);
create index admin_audit_log_org_idx on app_private.admin_audit_log (organization_id, created_at desc);
create index admin_audit_log_created_idx on app_private.admin_audit_log (created_at desc);
alter table app_private.admin_audit_log enable row level security;
revoke all on app_private.admin_audit_log from public, anon, authenticated;

create or replace function app_private.log_admin_action(
  p_action text,
  p_org uuid,
  p_target_user uuid default null,
  p_detail jsonb default '{}'::jsonb,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_target_email text;
begin
  select u.email::text into v_email from auth.users u where u.id = auth.uid();
  if p_target_user is not null then
    select u.email::text into v_target_email from auth.users u where u.id = p_target_user;
  end if;
  insert into app_private.admin_audit_log
    (actor_id, actor_email, action, organization_id, target_user_id, target_email, detail, reason)
  values
    (auth.uid(), v_email, p_action, p_org, p_target_user, v_target_email,
     coalesce(p_detail, '{}'::jsonb), nullif(btrim(p_reason), ''));
end; $$;
revoke execute on function app_private.log_admin_action(text, uuid, uuid, jsonb, text)
  from public, anon, authenticated;

-- Invitaciones: se registran con un trigger para no copiar las RPC de 0026.
-- Solo cuenta lo que hace un admin (el canje corre como service_role).
create or replace function app_private.log_invitation_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then return new; end if;
  if tg_op = 'INSERT' then
    perform app_private.log_admin_action('invitation.create', null, null,
      jsonb_build_object('invitation_id', new.id, 'note', new.note, 'email', new.email));
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform app_private.log_admin_action('invitation.revoke', null, null,
      jsonb_build_object('invitation_id', new.id, 'note', new.note, 'email', new.email));
  end if;
  return new;
end; $$;

create trigger invitations_audit
  after insert or update of revoked_at on app_private.invitations
  for each row execute function app_private.log_invitation_change();

-- ---------- Suspensión en la página pública ----------
-- Copia exacta de 0003 (verificada contra producción) + el chequeo de suspensión.
create or replace function _resolve_property(p_org_slug text, p_property_slug text)
returns public.properties language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_suspended timestamptz; v_prop public.properties; v_count int;
begin
  select id, suspended_at into v_org, v_suspended from public.organizations where slug = p_org_slug;
  if v_org is null then raise exception 'ORG_NOT_FOUND'; end if;
  if v_suspended is not null then raise exception 'ORG_SUSPENDED'; end if;

  if p_property_slug is not null then
    select * into v_prop from public.properties
     where organization_id = v_org and slug = p_property_slug and is_active = true;
    if not found then raise exception 'PROPERTY_NOT_FOUND'; end if;
  else
    select count(*) into v_count from public.properties
     where organization_id = v_org and is_active = true;
    if v_count = 0 then raise exception 'PROPERTY_NOT_FOUND'; end if;
    if v_count > 1 then raise exception 'PROPERTY_AMBIGUOUS'; end if;
    select * into v_prop from public.properties
     where organization_id = v_org and is_active = true;
  end if;
  return v_prop;
end; $$;

-- Los calendarios de Airbnb/Booking dejan de importarse mientras dura la
-- suspensión. Los feeds son una foto completa: al reactivar, la primera
-- corrida se pone al día.
create or replace function list_units_for_ical_sync()
returns table (
  unit_id           uuid,
  organization_id   uuid,
  airbnb_ical_url   text,
  booking_ical_url  text
)
language sql stable security definer set search_path = '' as $$
  select u.id, u.organization_id, u.airbnb_ical_url, u.booking_ical_url
  from public.units u
  join public.organizations o on o.id = u.organization_id
  where u.is_active
    and o.suspended_at is null
    and (u.airbnb_ical_url is not null or u.booking_ical_url is not null);
$$;

-- ---------- Listado de clientes (sin plata) ----------
-- Cambian las columnas de salida: hay que dropear.
drop function if exists operon_clients();

create function operon_clients()
returns table (
  organization_id     uuid,
  name                text,
  slug                text,
  created_at          timestamptz,
  suspended_at        timestamptz,
  owner_email         text,
  owner_name          text,
  last_sign_in_at     timestamptz,
  members             int,
  units               int,
  reservations_total  int,
  reservations_month  int,
  last_reservation_at timestamptz,
  deposit_configured  boolean,
  mp_connected        boolean,
  mp_live             boolean,
  link_shared         boolean,
  email_failed_30d    int,
  email_stuck         int
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
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
    o.suspended_at,
    own.email,
    own.full_name,
    act.last_sign_in_at,
    coalesce(mem.n, 0),
    coalesce(un.n, 0),
    coalesce(res.total, 0),
    coalesce(res.in_month, 0),
    res.last_at,
    coalesce(prop.deposit_pct, 0) > 0,
    mp.organization_id is not null,
    coalesce(mp.live_mode, false),
    o.link_shared_at is not null,
    coalesce(mail.failed_30d, 0),
    coalesce(mail.stuck, 0)
  from public.organizations o
  left join lateral (
    select p.deposit_pct
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
    select
      -- Un 'failed' sin próximo intento es definitivo (agotó los 8 reintentos).
      (count(*) filter (
         where n.delivery_status = 'failed' and n.next_attempt_at is null
           and n.created_at > now() - interval '30 days'
      ))::int as failed_30d,
      (count(*) filter (
         where (n.delivery_status = 'processing' and n.processing_started_at < now() - interval '1 hour')
            or (n.delivery_status = 'pending' and n.next_attempt_at < now() - interval '1 hour')
      ))::int as stuck
      from public.notification_outbox n
     where n.organization_id = o.id
  ) mail on true
  left join app_private.mp_credential mp on mp.organization_id = o.id
  order by (o.suspended_at is not null), o.created_at desc;
end $$;

revoke execute on function operon_clients() from public, anon;
grant execute on function operon_clients() to authenticated;

-- ---------- Ficha de un cliente ----------
create or replace function operon_client_detail(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org public.organizations;
  v_month_start date := date_trunc('month', now() at time zone 'America/Argentina/Cordoba')::date;
  v_month_end   date := (date_trunc('month', now() at time zone 'America/Argentina/Cordoba') + interval '1 month')::date;
  v_suspension jsonb;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_org from public.organizations where id = p_org;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;

  if v_org.suspended_at is not null then
    select jsonb_build_object('at', l.created_at, 'reason', l.reason, 'actor_email', l.actor_email)
      into v_suspension
      from app_private.admin_audit_log l
     where l.organization_id = p_org and l.action = 'org.suspend'
     order by l.created_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'org', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'slug', v_org.slug,
      'created_at', v_org.created_at,
      'suspended_at', v_org.suspended_at,
      'suspension', v_suspension,
      'link_shared_at', v_org.link_shared_at,
      'checklist_dismissed_at', v_org.checklist_dismissed_at
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'email', u.email,
               'full_name', pr.full_name,
               'role', m.role,
               'joined_at', m.created_at,
               'last_sign_in_at', u.last_sign_in_at,
               'is_platform_admin', exists (select 1 from public.platform_admins pa where pa.user_id = m.user_id)
             ) order by (m.role = 'owner') desc, m.created_at)
        from public.memberships m
        join auth.users u on u.id = m.user_id
        left join public.profiles pr on pr.id = m.user_id
       where m.organization_id = p_org
    ), '[]'::jsonb),
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'slug', p.slug,
               'city', p.city,
               'country', p.country,
               'timezone', p.timezone,
               'is_active', p.is_active,
               'deposit_configured', coalesce(p.deposit_pct, 0) > 0,
               'has_contact', (p.whatsapp is not null or p.phone is not null or p.email is not null)
             ) order by p.created_at)
        from public.properties p
       where p.organization_id = p_org
    ), '[]'::jsonb),
    'units', coalesce((
      -- Solo booleanos para iCal: las URLs llevan tokens secretos.
      select jsonb_agg(jsonb_build_object(
               'id', x.id,
               'name', x.name,
               'capacity', x.capacity,
               'is_active', x.is_active,
               'has_photo', x.photo_path is not null,
               'airbnb_configured', x.airbnb_ical_url is not null,
               'booking_configured', x.booking_ical_url is not null
             ) order by x.position, x.created_at)
        from public.units x
       where x.organization_id = p_org
    ), '[]'::jsonb),
    'reservations', jsonb_build_object(
      'total', (select count(*) from public.reservations r where r.organization_id = p_org),
      'month', (select count(*) from public.reservations r
                 where r.organization_id = p_org
                   and r.check_in >= v_month_start and r.check_in < v_month_end
                   and r.status not in ('cancelled', 'expired', 'inquiry')),
      'last_at', (select max(r.created_at) from public.reservations r where r.organization_id = p_org),
      'by_status', coalesce((
        select jsonb_object_agg(s.status, s.n)
          from (select r.status::text as status, count(*) as n
                  from public.reservations r
                 where r.organization_id = p_org
                 group by r.status) s
      ), '{}'::jsonb),
      -- Sin montos: fechas, estado y origen.
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'code', r.code,
                 'status', r.status,
                 'source', r.source,
                 'check_in', r.check_in,
                 'check_out', r.check_out,
                 'guest_name', g.full_name,
                 'unit_name', x.name,
                 'created_at', r.created_at
               ) order by r.created_at desc)
          from (select * from public.reservations r0
                 where r0.organization_id = p_org
                 order by r0.created_at desc
                 limit 10) r
          left join public.guests g on g.id = r.guest_id
          left join public.units x on x.id = r.unit_id
      ), '[]'::jsonb)
    ),
    'mercadopago', (
      select jsonb_build_object(
               'connected', mp.organization_id is not null,
               'live', coalesce(mp.live_mode, false),
               'connected_at', mp.connected_at)
        from (select 1) one
        left join app_private.mp_credential mp on mp.organization_id = p_org
    ),
    -- Nunca el payload: tiene montos y datos del huésped.
    'email_health', (
      select jsonb_build_object(
               'sent_30d', count(*) filter (where n.delivery_status = 'sent' and n.created_at > now() - interval '30 days'),
               'failed_final', count(*) filter (where n.delivery_status = 'failed' and n.next_attempt_at is null
                                                 and n.created_at > now() - interval '30 days'),
               'retrying', count(*) filter (where n.delivery_status = 'failed' and n.next_attempt_at is not null),
               'stuck', count(*) filter (where (n.delivery_status = 'processing' and n.processing_started_at < now() - interval '1 hour')
                                            or (n.delivery_status = 'pending' and n.next_attempt_at < now() - interval '1 hour')),
               'last_failed_at', max(n.updated_at) filter (where n.delivery_status = 'failed'),
               'last_error', (select left(n2.last_error, 200)
                                from public.notification_outbox n2
                               where n2.organization_id = p_org and n2.delivery_status = 'failed'
                               order by n2.updated_at desc limit 1))
        from public.notification_outbox n
       where n.organization_id = p_org
    )
  );
end; $$;

revoke execute on function operon_client_detail(uuid) from public, anon;
grant execute on function operon_client_detail(uuid) to authenticated;

-- ---------- Registro de acciones ----------
create or replace function operon_audit_log(p_org uuid default null, p_limit int default 100)
returns table (
  id                bigint,
  created_at        timestamptz,
  actor_email       text,
  action            text,
  organization_id   uuid,
  organization_name text,
  target_email      text,
  detail            jsonb,
  reason            text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  return query
  select l.id, l.created_at, l.actor_email, l.action, l.organization_id, o.name,
         l.target_email, l.detail, l.reason
    from app_private.admin_audit_log l
    left join public.organizations o on o.id = l.organization_id
   where p_org is null or l.organization_id = p_org
   order by l.created_at desc, l.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end; $$;

revoke execute on function operon_audit_log(uuid, int) from public, anon;
grant execute on function operon_audit_log(uuid, int) to authenticated;

-- ---------- Suspender / reactivar ----------
create or replace function operon_suspend_org(p_org uuid, p_reason text)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_reason text := btrim(coalesce(p_reason, '')); v_org public.organizations; v_now timestamptz := now();
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'REASON_REQUIRED'; end if;

  select * into v_org from public.organizations where id = p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if v_org.suspended_at is not null then raise exception 'ALREADY_SUSPENDED'; end if;

  update public.organizations set suspended_at = v_now, updated_at = v_now where id = p_org;
  perform app_private.log_admin_action('org.suspend', p_org, null, '{}'::jsonb, v_reason);
  return v_now;
end; $$;

create or replace function operon_reactivate_org(p_org uuid, p_reason text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'REASON_TOO_LONG'; end if;

  select * into v_org from public.organizations where id = p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if v_org.suspended_at is null then raise exception 'NOT_SUSPENDED'; end if;

  update public.organizations set suspended_at = null, updated_at = now() where id = p_org;
  perform app_private.log_admin_action('org.reactivate', p_org, null,
    jsonb_build_object('suspended_since', v_org.suspended_at), v_reason);
  return true;
end; $$;

revoke execute on function operon_suspend_org(uuid, text) from public, anon;
revoke execute on function operon_reactivate_org(uuid, text) from public, anon;
grant execute on function operon_suspend_org(uuid, text) to authenticated;
grant execute on function operon_reactivate_org(uuid, text) to authenticated;

-- ---------- Soporte de cuentas ----------
-- Quita la membresía; la cuenta (auth.users) queda. Nunca el último dueño.
create or replace function operon_remove_member(p_org uuid, p_user uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_reason text := btrim(coalesce(p_reason, '')); v_role public.membership_role; v_owners int;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then raise exception 'REASON_REQUIRED'; end if;

  -- Serializa contra otra baja simultánea en el mismo complejo.
  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;

  select role into v_role from public.memberships where organization_id = p_org and user_id = p_user;
  if not found then raise exception 'NOT_A_MEMBER'; end if;

  if v_role = 'owner' then
    select count(*) into v_owners from public.memberships where organization_id = p_org and role = 'owner';
    if v_owners <= 1 then raise exception 'LAST_OWNER'; end if;
  end if;

  -- Se registra antes de borrar para conservar el email del miembro.
  perform app_private.log_admin_action('member.remove', p_org, p_user,
    jsonb_build_object('role', v_role), v_reason);
  delete from public.memberships where organization_id = p_org and user_id = p_user;
  return true;
end; $$;

-- Autoriza y registra el link de nueva contraseña; el link lo genera el
-- servidor con service role DESPUÉS de esto y nunca se guarda.
create or replace function operon_prepare_recovery(p_org uuid, p_user uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;

  if not exists (select 1 from public.memberships where organization_id = p_org and user_id = p_user) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) then
    raise exception 'TARGET_IS_PLATFORM_ADMIN';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user;
  if v_email is null then raise exception 'NO_EMAIL'; end if;

  perform app_private.log_admin_action('member.recovery_link', p_org, p_user);
  return v_email;
end; $$;

revoke execute on function operon_remove_member(uuid, uuid, text) from public, anon;
revoke execute on function operon_prepare_recovery(uuid, uuid) from public, anon;
grant execute on function operon_remove_member(uuid, uuid, text) to authenticated;
grant execute on function operon_prepare_recovery(uuid, uuid) to authenticated;
