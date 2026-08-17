-- ============================================================
-- Operon Reservas — Endurecer RLS de reservations/payments +
-- RPC pública de estado de reserva (para /pago)
-- ============================================================

-- ---------- Parte 1: RLS de solo lectura para reservations/payments ----------
-- Las policies originales (0002) eran "for all" (RW completo) para
-- cualquier authenticated miembro de la org. Nunca se usó esa escritura
-- directa: TODO cambio de estado/monto pasa por RPC SECURITY DEFINER
-- (_book, create_manual_reservation, transition_reservation) o por las
-- rutas API de Mercado Pago con service_role (que bypassa RLS igual).
-- Con plata real circulando ahora, cerramos esa puerta abierta pero sin
-- usar: el panel solo necesita LEER estas dos tablas.
drop policy if exists reservations_rw on reservations;
create policy reservations_select on reservations for select to authenticated
  using ( public.is_member_of(organization_id) );

drop policy if exists payments_rw on payments;
create policy payments_select on payments for select to authenticated
  using ( public.is_member_of(organization_id) );

-- ---------- Parte 2: estado público de una reserva por código ----------
-- La página /pago no puede confiar en el query param que devuelve MP al
-- redirigir (el webhook puede confirmar antes o después de ese redirect).
-- Esta RPC le permite consultar el estado REAL contra la base, sabiendo
-- solo el slug de la org + el código de reserva (el mismo par que ya usa
-- api/mp/checkout). Mismo patrón que public_property/public_availability
-- (0003): SECURITY DEFINER, sin datos privados del alojamiento.
create or replace function public_reservation_status(p_org_slug text, p_code text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_row record;
  v_paid numeric;
begin
  select id into v_org from public.organizations where slug = p_org_slug;
  if v_org is null then raise exception 'ORG_NOT_FOUND'; end if;

  select r.id, r.code, r.status, r.check_in, r.check_out, r.guests_count,
         r.total_amount, r.deposit_amount, r.currency,
         p.name as property_name, p.whatsapp as property_whatsapp,
         u.name as unit_name
    into v_row
  from public.reservations r
  join public.properties p on p.id = r.property_id
  join public.units u on u.id = r.unit_id
  where r.organization_id = v_org and r.code = p_code;

  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where reservation_id = v_row.id and kind = 'deposit' and status = 'paid';

  return jsonb_build_object(
    'code', v_row.code,
    'status', v_row.status,
    'property_name', v_row.property_name,
    'property_whatsapp', v_row.property_whatsapp,
    'unit_name', v_row.unit_name,
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

revoke execute on function public.public_reservation_status(text, text) from public;
grant execute on function public.public_reservation_status(text, text) to anon, authenticated;
