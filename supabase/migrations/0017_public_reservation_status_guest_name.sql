-- Suma el nombre del huésped al estado público de la reserva, para armar el
-- mensaje pre-cargado de WhatsApp ("Hola soy [nombre], reservé para...").
-- El `code` ya funciona como credencial de acceso a este endpoint (igual que
-- el resto de los datos que devuelve: montos, fechas), así que agregar el
-- nombre no cambia el modelo de confianza.
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
         u.name as unit_name, g.full_name as guest_name
    into v_row
  from public.reservations r
  join public.properties p on p.id = r.property_id
  join public.units u on u.id = r.unit_id
  left join public.guests g on g.id = r.guest_id
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
