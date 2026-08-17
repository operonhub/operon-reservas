-- ============================================================
-- Operon Reservas — Aviso al propietario cuando se confirma sola
-- ============================================================
-- Hoy el admin solo recibe mail al CREARSE la reserva (aún sin pagar).
-- Con el cobro automático de Mercado Pago, falta el aviso que de verdad
-- importa: "se acreditó la seña y la reserva quedó confirmada". Se agrega
-- como evento nuevo de la MISMA outbox transaccional (0006), sin tocar el
-- aviso al huésped que ya existe para todo cambio de estado.
-- ============================================================

-- El check de event_type era una lista cerrada; se amplía para el evento nuevo.
alter table notification_outbox drop constraint if exists notification_outbox_event_type_check;
alter table notification_outbox add constraint notification_outbox_event_type_check
  check (event_type in (
    'reservation_created_admin',
    'reservation_status_guest',
    'reservation_confirmed_admin'
  ));

-- Resolución del mail del admin: mail de la property, o si no está
-- configurado, el primer owner/admin con mail. Antes vivía inline en la
-- rama INSERT del trigger; se factoriza para reusarla también al confirmar.
create or replace function _resolve_admin_email(p_org uuid, p_property_email text)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_email text;
begin
  v_email := nullif(trim(coalesce(p_property_email, '')), '');
  if v_email is not null then return v_email; end if;

  select nullif(trim(pr.email), '') into v_email
  from public.memberships m
  join public.profiles pr on pr.id = m.user_id
  where m.organization_id = p_org
    and m.role in ('owner', 'admin')
    and nullif(trim(pr.email), '') is not null
  order by case m.role when 'owner' then 0 else 1 end, m.created_at
  limit 1;

  return v_email;
end;
$$;
revoke execute on function _resolve_admin_email(uuid, text) from public, anon, authenticated;

create or replace function enqueue_reservation_notification()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_property_name text;
  v_property_email text;
  v_unit_name text;
  v_guest_email text;
  v_guest_name text;
  v_admin_email text;
  v_payload jsonb;
begin
  select o.name, p.name, nullif(trim(p.email), ''), u.name,
         nullif(trim(g.email), ''), nullif(trim(g.full_name), '')
    into v_org_name, v_property_name, v_property_email, v_unit_name,
         v_guest_email, v_guest_name
  from public.organizations o
  join public.properties p on p.id = new.property_id
  join public.units u on u.id = new.unit_id
  left join public.guests g on g.id = new.guest_id
  where o.id = new.organization_id;

  v_payload := jsonb_build_object(
    'reservation_id', new.id,
    'reservation_code', new.code,
    'organization_name', v_org_name,
    'property_name', v_property_name,
    'property_email', v_property_email,
    'unit_name', v_unit_name,
    'guest_name', v_guest_name,
    'check_in', new.check_in,
    'check_out', new.check_out,
    'guests_count', new.guests_count,
    'total_amount', new.total_amount,
    'deposit_amount', new.deposit_amount,
    'currency', new.currency,
    'source', new.source
  );

  if tg_op = 'INSERT' then
    -- Una carga manual ya es conocida por el admin que la creó.
    if new.source <> 'manual' then
      v_admin_email := public._resolve_admin_email(new.organization_id, v_property_email);

      insert into public.notification_outbox (
        organization_id, reservation_id, event_type, reservation_status,
        recipient_email, idempotency_key, payload, delivery_status,
        next_attempt_at, last_error
      ) values (
        new.organization_id, new.id, 'reservation_created_admin', new.status,
        v_admin_email, 'reservation-created-admin:' || new.id,
        v_payload || jsonb_build_object('new_status', new.status),
        case when v_admin_email is null then 'skipped' else 'pending' end,
        case when v_admin_email is null then null else now() end,
        case when v_admin_email is null then 'ADMIN_EMAIL_NOT_CONFIGURED' else null end
      ) on conflict (idempotency_key) do nothing;
    end if;

    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.notification_outbox (
      organization_id, reservation_id, event_type, reservation_status,
      recipient_email, idempotency_key, payload, delivery_status,
      next_attempt_at, last_error
    ) values (
      new.organization_id, new.id, 'reservation_status_guest', new.status,
      v_guest_email,
      'reservation-status-guest:' || new.id || ':' || old.status || ':' || new.status,
      v_payload || jsonb_build_object('old_status', old.status, 'new_status', new.status),
      case when v_guest_email is null then 'skipped' else 'pending' end,
      case when v_guest_email is null then null else now() end,
      case when v_guest_email is null then 'GUEST_EMAIL_NOT_CONFIGURED' else null end
    ) on conflict (idempotency_key) do nothing;
  end if;

  -- Confirmación automática vía pago (pending/pending_payment → confirmed):
  -- el aviso que de verdad le importa al propietario ("se cobró la seña").
  if old.status is distinct from new.status
     and old.status in ('pending', 'pending_payment')
     and new.status = 'confirmed' then
    v_admin_email := public._resolve_admin_email(new.organization_id, v_property_email);

    insert into public.notification_outbox (
      organization_id, reservation_id, event_type, reservation_status,
      recipient_email, idempotency_key, payload, delivery_status,
      next_attempt_at, last_error
    ) values (
      new.organization_id, new.id, 'reservation_confirmed_admin', new.status,
      v_admin_email,
      'reservation-confirmed-admin:' || new.id,
      v_payload || jsonb_build_object('old_status', old.status, 'new_status', new.status),
      case when v_admin_email is null then 'skipped' else 'pending' end,
      case when v_admin_email is null then null else now() end,
      case when v_admin_email is null then 'ADMIN_EMAIL_NOT_CONFIGURED' else null end
    ) on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function enqueue_reservation_notification() from public, anon, authenticated;
