-- ============================================================
-- Operon Reservas — 0025: permisos por rol, límites de uso y avisos
-- ============================================================
-- Segunda tanda de la auditoría (2026-09-10), con las decisiones sobre las
-- recomendaciones. Cada sección cita el hallazgo.
--
-- Orden de deploy: el código de esta rama ANTES que esta migración. Con el
-- código viejo, un usuario 'staff' vería botones de edición que la base ya
-- no le acepta (hoy no hay ningún 'staff' en producción: impacto nulo).
-- ============================================================


-- ------------------------------------------------------------
-- M-02 · Permisos por rol
-- ------------------------------------------------------------
-- membership_role existía desde 0001 y ninguna policy lo miraba: un 'staff'
-- podía cambiar precios, borrar unidades o reconfigurar el alojamiento.
-- Decisión: staff ve todo y gestiona reservas y bloqueos; tarifas,
-- unidades, configuración, fotos y Mercado Pago quedan para owner/admin.
create or replace function is_admin_of(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.organization_id = org
      and m.role in ('owner', 'admin')
  ) or public.is_platform_admin();
$$;
revoke execute on function is_admin_of(uuid) from public, anon;
grant execute on function is_admin_of(uuid) to authenticated, service_role;

drop policy if exists rates_rw on rates;
create policy rates_select on rates for select to authenticated
  using ( public.is_member_of(organization_id) );
create policy rates_insert on rates for insert to authenticated
  with check ( public.is_admin_of(organization_id) );
create policy rates_update on rates for update to authenticated
  using ( public.is_admin_of(organization_id) ) with check ( public.is_admin_of(organization_id) );
create policy rates_delete on rates for delete to authenticated
  using ( public.is_admin_of(organization_id) );

drop policy if exists units_rw on units;
create policy units_select on units for select to authenticated
  using ( public.is_member_of(organization_id) );
create policy units_insert on units for insert to authenticated
  with check ( public.is_admin_of(organization_id) );
create policy units_update on units for update to authenticated
  using ( public.is_admin_of(organization_id) ) with check ( public.is_admin_of(organization_id) );
create policy units_delete on units for delete to authenticated
  using ( public.is_admin_of(organization_id) );

-- El panel solo actualiza la propiedad; altas y bajas son del service role.
drop policy if exists properties_rw on properties;
create policy properties_select on properties for select to authenticated
  using ( public.is_member_of(organization_id) );
create policy properties_update on properties for update to authenticated
  using ( public.is_admin_of(organization_id) ) with check ( public.is_admin_of(organization_id) );

-- Fotos de unidades y portada: la lectura sigue pública (0020); escribir
-- pasa a owner/admin, igual que las unidades y la configuración.
drop policy if exists "unit_photos_insert" on storage.objects;
create policy "unit_photos_insert" on storage.objects for insert to authenticated
  with check ( bucket_id = 'unit-photos' and public.is_admin_of(((storage.foldername(name))[1])::uuid) );
drop policy if exists "unit_photos_update" on storage.objects;
create policy "unit_photos_update" on storage.objects for update to authenticated
  using ( bucket_id = 'unit-photos' and public.is_admin_of(((storage.foldername(name))[1])::uuid) );
drop policy if exists "unit_photos_delete" on storage.objects;
create policy "unit_photos_delete" on storage.objects for delete to authenticated
  using ( bucket_id = 'unit-photos' and public.is_admin_of(((storage.foldername(name))[1])::uuid) );


-- ------------------------------------------------------------
-- A-03 · Límite de intentos en lo público, dentro de Postgres y por IP
-- ------------------------------------------------------------
-- La reserva pública y la consulta de estado por código no tenían tope: se
-- podía llenar el calendario de reservas falsas o probar códigos (R- + 6
-- hex) hasta dar con uno ajeno.
--
-- Dos puertas, un mismo contador:
--   * quien llama a la RPC directo (anon, con la clave pública) queda
--     limitado acá, por la IP que Cloudflare deja en cf-connecting-ip y el
--     cliente no puede falsificar;
--   * la app llama como service_role (sus pedidos salen todos de la IP de
--     Vercel) y limita antes, por la IP real del huésped, con rate_limit_hit.
create table if not exists app_private.rate_limit_counters (
  bucket       text not null,
  subject      text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, subject, window_start)
);
alter table app_private.rate_limit_counters enable row level security;
revoke all on app_private.rate_limit_counters from public, anon, authenticated;

-- Cuenta un intento y dice si sigue dentro del límite de la ventana.
create or replace function rate_limit_hit(p_bucket text, p_subject text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_window timestamptz; v_hits int;
begin
  if coalesce(p_subject, '') = '' then return true; end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into app_private.rate_limit_counters as c (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window, 1)
  on conflict (bucket, subject, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  -- Limpieza oportunista: las ventanas de más de un día ya no cuentan.
  if random() < 0.01 then
    delete from app_private.rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;
revoke execute on function rate_limit_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, text, int, int) to service_role;

-- IP del cliente de un pedido a PostgREST (null fuera de un pedido).
create or replace function _request_client_ip() returns text
language sql stable set search_path = '' as $$
  select nullif(coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
    split_part(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1)
  ), '');
$$;
revoke execute on function _request_client_ip() from public, anon, authenticated;

-- Topes para quien llama directo; holgados para un huésped real. /pago
-- consulta el estado cada 2,5 s durante un minuto (24 veces por visita).
create or replace function _enforce_public_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not public.rate_limit_hit(p_bucket, public._request_client_ip(), p_limit, p_window_seconds) then
    raise exception 'RATE_LIMITED';
  end if;
end;
$$;
revoke execute on function _enforce_public_rate_limit(text, int, int) from public, anon, authenticated;

-- Misma versión que 0024 (idéntica a producción), con el límite al principio.
create or replace function create_public_reservation(
  p_org_slug text, p_property_slug text, p_unit_id uuid,
  p_check_in date, p_check_out date, p_guests int,
  p_full_name text, p_email text, p_phone text, p_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prop public.properties; v_guest uuid; v_res public.reservations;
begin
  perform public._enforce_public_rate_limit('reserva_publica', 10, 3600);

  v_prop := public._resolve_property(p_org_slug, p_property_slug);
  v_guest := public._upsert_guest(v_prop.organization_id, p_full_name, p_email, p_phone);

  v_res := public._book(
    v_prop.organization_id, v_prop.id, p_unit_id, v_guest,
    p_check_in, p_check_out, p_guests, 'pending', 'direct', null, 30
  );

  if nullif(trim(p_notes), '') is not null then
    update public.reservations set notes = p_notes where id = v_res.id returning * into v_res;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', v_res.code, 'status', v_res.status,
    'check_in', v_res.check_in, 'check_out', v_res.check_out,
    'total_amount', v_res.total_amount, 'deposit_amount', v_res.deposit_amount,
    'currency', v_res.currency, 'hold_expires_at', v_res.hold_expires_at
  );
end; $$;

-- Misma versión que 0017 (idéntica a producción), con el límite al principio.
-- Deja de ser STABLE: ahora cuenta el intento (escribe). supabase-js llama a
-- las RPC por POST, así que no cambia nada para quien la usa.
create or replace function public_reservation_status(p_org_slug text, p_code text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_row record;
  v_paid numeric;
begin
  perform public._enforce_public_rate_limit('estado_reserva', 120, 600);

  -- "No existe" se devuelve como null y no como excepción: una excepción
  -- revierte la transacción ENTERA, contador incluido, y probar códigos
  -- (casi todo errores) no sumaría nunca. La app ya trata null como
  -- "no encontramos esa reserva".
  select id into v_org from public.organizations where slug = p_org_slug;
  if v_org is null then return null; end if;

  select r.id, r.code, r.status, r.check_in, r.check_out, r.guests_count,
         r.total_amount, r.deposit_amount, r.currency,
         p.name as property_name, p.whatsapp as property_whatsapp,
         u.name as unit_name, g.full_name as guest_name
    into v_row
  from public.reservations r
  join public.properties p on p.id = r.property_id
  join public.units u on u.id = r.unit_id
  left join public.guests g on g.id = r.guest_id
  where r.organization_id = v_org and r.code = p_code;

  if not found then return null; end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where reservation_id = v_row.id and kind = 'deposit' and status = 'paid';

  return jsonb_build_object(
    'code', v_row.code,
    'status', v_row.status,
    'property_name', v_row.property_name,
    'property_whatsapp', v_row.property_whatsapp,
    'unit_name', v_row.unit_name,
    'guest_name', v_row.guest_name,
    'check_in', v_row.check_in,
    'check_out', v_row.check_out,
    'guests_count', v_row.guests_count,
    'total_amount', v_row.total_amount,
    'deposit_amount', v_row.deposit_amount,
    'deposit_paid', v_paid,
    'currency', v_row.currency
  );
end;
$$;


-- ------------------------------------------------------------
-- A-03 · Tope de extensiones de la retención desde el checkout
-- ------------------------------------------------------------
-- /api/mp/checkout reiniciaba el hold en cada llamada, sin límite: con el
-- código y el slug, cualquiera podía mantener una fecha retenida para
-- siempre. Ahora son 3 extensiones como máximo y nunca acortan el hold.
alter table reservations add column if not exists hold_extensions int not null default 0;

create or replace function extend_checkout_hold(p_reservation uuid, p_minutes int default 15, p_max_extensions int default 3)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.reservations
     set hold_expires_at = greatest(coalesce(hold_expires_at, now()), now() + make_interval(mins => p_minutes)),
         hold_extensions = hold_extensions + 1
   where id = p_reservation
     and status in ('pending', 'pending_payment')
     and hold_extensions < p_max_extensions;
  return found;
end;
$$;
revoke execute on function extend_checkout_hold(uuid, int, int) from public, anon, authenticated;
grant execute on function extend_checkout_hold(uuid, int, int) to service_role;


-- ------------------------------------------------------------
-- A-02 · La retención dura hasta el vencimiento del cupón de efectivo
-- ------------------------------------------------------------
-- Cuando el huésped genera un cupón de Rapipago o Pago Fácil, Mercado Pago
-- avisa con el pago "pendiente" y su fecha de vencimiento. Recién ahí la
-- retención se estira hasta ese vencimiento (5 días como techo): un
-- checkout abandonado no bloquea nada, y quien ya sacó el cupón no pierde
-- la fecha mientras va a pagar. Solo alarga, nunca acorta.
create or replace function extend_hold_for_offline_payment(p_reservation uuid, p_until timestamptz)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_until timestamptz := least(p_until, now() + interval '5 days');
begin
  if v_until is null or v_until <= now() then return false; end if;
  update public.reservations
     set hold_expires_at = v_until
   where id = p_reservation
     and status in ('pending', 'pending_payment')
     and (hold_expires_at is null or hold_expires_at < v_until);
  return found;
end;
$$;
revoke execute on function extend_hold_for_offline_payment(uuid, timestamptz) from public, anon, authenticated;
grant execute on function extend_hold_for_offline_payment(uuid, timestamptz) to service_role;


-- ------------------------------------------------------------
-- A-02 · Aviso al propietario: se cobró una fecha que ya se revendió
-- ------------------------------------------------------------
-- Cuando un pago tardío llega y la fecha ya la tomó otra reserva,
-- recover_paid_expired_reservation (0024) no puede recuperar nada y el caso
-- quedaba solo en el log de Vercel. Ahora va un email al propietario por la
-- misma cola de notificaciones, con lo necesario para contactar al huésped.
alter table notification_outbox drop constraint if exists notification_outbox_event_type_check;
alter table notification_outbox add constraint notification_outbox_event_type_check
  check (event_type in (
    'reservation_created_admin',
    'reservation_status_guest',
    'reservation_confirmed_admin',
    'payment_orphaned_admin'
  ));

create or replace function _enqueue_orphaned_payment_notice(p_reservation uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_admin_email text; v_paid numeric; v_currency text;
begin
  select res.id, res.organization_id, res.code, res.check_in, res.check_out, res.guests_count, res.currency,
         o.name as org_name, p.name as property_name, nullif(trim(p.email), '') as property_email,
         u.name as unit_name, g.full_name as guest_name, g.email as guest_email, g.phone as guest_phone
    into r
  from public.reservations res
  join public.organizations o on o.id = res.organization_id
  join public.properties p on p.id = res.property_id
  join public.units u on u.id = res.unit_id
  left join public.guests g on g.id = res.guest_id
  where res.id = p_reservation;
  if not found then return; end if;

  select amount, currency into v_paid, v_currency
  from public.payments
  where reservation_id = p_reservation and kind = 'deposit' and status = 'paid'
  order by coalesce(paid_at, created_at) desc
  limit 1;

  v_admin_email := public._resolve_admin_email(r.organization_id, r.property_email);

  insert into public.notification_outbox (
    organization_id, reservation_id, event_type, reservation_status,
    recipient_email, idempotency_key, payload, delivery_status,
    next_attempt_at, last_error
  ) values (
    r.organization_id, r.id, 'payment_orphaned_admin', 'expired',
    v_admin_email, 'payment-orphaned-admin:' || r.id,
    jsonb_build_object(
      'reservation_id', r.id, 'reservation_code', r.code,
      'organization_name', r.org_name, 'property_name', r.property_name, 'unit_name', r.unit_name,
      'guest_name', r.guest_name, 'guest_email', r.guest_email, 'guest_phone', r.guest_phone,
      'check_in', r.check_in, 'check_out', r.check_out, 'guests_count', r.guests_count,
      'paid_amount', v_paid, 'currency', coalesce(v_currency, r.currency)
    ),
    case when v_admin_email is null then 'skipped' else 'pending' end,
    case when v_admin_email is null then null else now() end,
    case when v_admin_email is null then 'ADMIN_EMAIL_NOT_CONFIGURED' else null end
  ) on conflict (idempotency_key) do nothing;
end;
$$;
revoke execute on function _enqueue_orphaned_payment_notice(uuid) from public, anon, authenticated;

-- Igual que 0024, más el aviso cuando la fecha ya no está.
create or replace function recover_paid_expired_reservation(p_reservation uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare v public.reservations;
begin
  select * into v from public.reservations where id = p_reservation for update;
  if not found then return 'NOT_FOUND'; end if;
  if v.status <> 'expired' then return 'NOT_EXPIRED'; end if;

  begin
    insert into public.unit_occupancy
      (organization_id, unit_id, during, kind, reservation_id)
    values
      (v.organization_id, v.unit_id, daterange(v.check_in, v.check_out, '[)'),
       'reservation', v.id);
  exception when exclusion_violation then
    perform public._enqueue_orphaned_payment_notice(v.id);
    return 'UNAVAILABLE';
  end;

  update public.reservations
     set status = 'confirmed', hold_expires_at = null
   where id = v.id;

  return 'RECOVERED';
end;
$$;
revoke execute on function recover_paid_expired_reservation(uuid) from public, anon, authenticated;
grant execute on function recover_paid_expired_reservation(uuid) to service_role;


-- ------------------------------------------------------------
-- Advisors de Supabase · funciones del panel sin acceso anónimo
-- ------------------------------------------------------------
-- Estas se ejecutaban sin sesión: las protegía un chequeo interno, pero dos
-- (transition_reservation y simulate_price) respondían si un id existía
-- antes de rechazar. Supabase las concede a PUBLIC y a anon por defecto,
-- así que hay que revocar ambos y volver a conceder a quien las usa.
revoke execute on function create_block(uuid, uuid, date, date, text) from public, anon;
revoke execute on function create_manual_reservation(uuid, uuid, uuid, text, text, text, date, date, int, reservation_status, text) from public, anon;
revoke execute on function transition_reservation(uuid, reservation_status) from public, anon;
revoke execute on function simulate_price(uuid, date, date, int) from public, anon;
revoke execute on function is_member_of(uuid) from public, anon;
revoke execute on function is_platform_admin() from public, anon;
revoke execute on function shares_org(uuid) from public, anon;

grant execute on function create_block(uuid, uuid, date, date, text) to authenticated, service_role;
grant execute on function create_manual_reservation(uuid, uuid, uuid, text, text, text, date, date, int, reservation_status, text) to authenticated, service_role;
grant execute on function transition_reservation(uuid, reservation_status) to authenticated, service_role;
grant execute on function simulate_price(uuid, date, date, int) to authenticated, service_role;
grant execute on function is_member_of(uuid) to authenticated, service_role;
grant execute on function is_platform_admin() to authenticated, service_role;
grant execute on function shares_org(uuid) to authenticated, service_role;


-- ------------------------------------------------------------
-- Deriva repo/producción · _can_transition
-- ------------------------------------------------------------
-- Producción acepta pasar a 'expired' desde pending/pending_payment (se
-- aplicó al consolidar la expiración de retenciones y nunca volvió al
-- repo, que dice lo contrario en 0011). Se trae tal cual está allá para que
-- una base armada desde las migraciones sea igual a producción. Es
-- inofensivo: el panel no ofrece ese destino (lib/constants.ts) y desde
-- 'expired' no se sale por acá; solo un pago real lo recupera (0024).
create or replace function _can_transition(p_from reservation_status, p_to reservation_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'inquiry'         then p_to in ('pending','pending_payment','cancelled')
    when 'pending'         then p_to in ('pending_payment','confirmed','cancelled','expired')
    when 'pending_payment' then p_to in ('confirmed','cancelled','expired')
    when 'confirmed'       then p_to in ('completed','cancelled')
    else false
  end;
$$;
