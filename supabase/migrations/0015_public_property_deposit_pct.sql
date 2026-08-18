-- La web pública necesita el % de seña para mostrar el desglose de precio
-- ANTES de reservar (total / seña / saldo), no sólo después. No es un dato
-- sensible: ya es visible indirectamente vía deposit_amount en cualquier
-- reserva creada. También suma whatsapp/phone para el botón "Hablar con el
-- alojamiento" de la pantalla de confirmación.
create or replace function public_property(p_org_slug text, p_property_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_prop public.properties;
begin
  v_prop := public._resolve_property(p_org_slug, p_property_slug);
  return jsonb_build_object(
    'name', v_prop.name, 'description', v_prop.description,
    'city', v_prop.city, 'currency', v_prop.currency,
    'checkin_time', v_prop.checkin_time, 'checkout_time', v_prop.checkout_time,
    'deposit_pct', v_prop.deposit_pct,
    'whatsapp', v_prop.whatsapp, 'phone', v_prop.phone
  );
end; $$;
