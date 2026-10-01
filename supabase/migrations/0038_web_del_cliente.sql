-- ============================================================
-- 0038 — La web de cada cliente y si está conectada a su panel
-- ============================================================
-- Cada cliente pega el widget de reservas en su web y hasta hoy no había forma
-- de saber si quedó bien puesto (slug equivocado, widget sin configurar, un
-- iframe donde el pago no funciona…). Desde la ficha de /operon el admin carga
-- la dirección de la web, la verifica y ve el estado. La verificación la hace
-- el servidor (lee la página y busca el widget, src/lib/operon/website.ts) y
-- guarda el resultado con operon_record_website_check.
--
-- Estados: connected (widget con el slug correcto), link_only (solo un link o
-- un iframe a su página de reservas), mismatch (widget de OTRO complejo),
-- unconfigured (widget sin completar), demo (la versión de las demos de
-- prospección, sin backend), not_found, unreachable.
-- ============================================================

alter table public.organizations
  add column website_url        text,
  add column website_status     text,
  add column website_note       text,
  add column website_checked_at timestamptz,
  add constraint organizations_website_url_chk
    check (website_url is null or (website_url ~ '^https?://[^[:space:]]+$' and char_length(website_url) <= 300)),
  add constraint organizations_website_status_chk
    check (website_status is null or website_status in
      ('connected', 'link_only', 'mismatch', 'unconfigured', 'demo', 'not_found', 'unreachable')),
  add constraint organizations_website_note_chk
    check (website_note is null or char_length(website_note) <= 300);

-- El registro de acciones solo acepta nombres de una lista cerrada (0033, 0034):
-- se suman los dos nuevos. Lista tomada de producción.
alter table app_private.admin_audit_log drop constraint admin_audit_log_action_check;
alter table app_private.admin_audit_log add constraint admin_audit_log_action_check check (action in (
  'org.suspend', 'org.reactivate', 'member.remove', 'member.recovery_link',
  'invitation.create', 'invitation.revoke',
  'zone_month.enable', 'zone_month.disable', 'zone_month.queue',
  'website.set', 'website.check'
));

-- Los miembros de la organización pueden leer su propia fila (política
-- organizations_select) pero no escribirla: no hay política de UPDATE.

-- Cargar o cambiar la web. Limpia el estado: la dirección nueva no está verificada.
create function public.operon_set_website(p_org uuid, p_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_url text := nullif(btrim(coalesce(p_url, '')), ''); v_org public.organizations;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_org from public.organizations where id = p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if v_url is not null and (v_url !~ '^https?://[^[:space:]]+$' or char_length(v_url) > 300) then
    raise exception 'INVALID_URL';
  end if;

  update public.organizations
     set website_url = v_url, website_status = null, website_note = null, website_checked_at = null
   where id = p_org;

  if v_url is distinct from v_org.website_url then
    perform app_private.log_admin_action('website.set', p_org, null,
      jsonb_build_object('url', v_url, 'previous', v_org.website_url));
  end if;
  return jsonb_build_object('website_url', v_url);
end; $$;

-- Guarda el resultado de verificar la web. Solo deja registro si el estado cambió.
create function public.operon_record_website_check(p_org uuid, p_status text, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_org public.organizations; v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 300);
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('connected', 'link_only', 'mismatch', 'unconfigured', 'demo', 'not_found', 'unreachable') then
    raise exception 'INVALID_STATUS';
  end if;
  select * into v_org from public.organizations where id = p_org for update;
  if not found then raise exception 'ORG_NOT_FOUND'; end if;
  if v_org.website_url is null then raise exception 'NO_WEBSITE'; end if;

  update public.organizations
     set website_status = p_status, website_note = v_note, website_checked_at = now()
   where id = p_org;

  if v_org.website_status is distinct from p_status then
    perform app_private.log_admin_action('website.check', p_org, null,
      jsonb_build_object('status', p_status, 'previous', v_org.website_status, 'note', v_note));
  end if;
  return true;
end; $$;

-- Listado para la tabla de clientes: quién tiene web cargada y en qué estado.
create function public.operon_websites()
returns table (organization_id uuid, website_url text, website_status text, website_note text, website_checked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN'; end if;
  return query
    select o.id, o.website_url, o.website_status, o.website_note, o.website_checked_at
      from public.organizations o
     where o.website_url is not null;
end; $$;

revoke execute on function public.operon_set_website(uuid, text) from public, anon;
revoke execute on function public.operon_record_website_check(uuid, text, text) from public, anon;
revoke execute on function public.operon_websites() from public, anon;
grant execute on function public.operon_set_website(uuid, text) to authenticated;
grant execute on function public.operon_record_website_check(uuid, text, text) to authenticated;
grant execute on function public.operon_websites() to authenticated;

-- La ficha del cliente suma los datos de su web. Copia exacta de 0033 (verificada
-- contra producción) con cuatro claves más en "org".
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
      'checklist_dismissed_at', v_org.checklist_dismissed_at,
      'website_url', v_org.website_url,
      'website_status', v_org.website_status,
      'website_note', v_org.website_note,
      'website_checked_at', v_org.website_checked_at
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
