-- ============================================================
-- 0039 — public_property informa la capacidad máxima del complejo
-- ============================================================
-- El selector de huéspedes del widget estaba escrito a mano (1 a 6). En un
-- complejo cuya cabaña más grande es para 5, elegir 6 no devolvía nada y el
-- huésped no sabía por qué. Ahora el widget y la página pública arman el
-- selector con este dato: si el dueño suma una unidad más grande, se actualiza
-- solo, sin tocar su web.
--
-- Copia exacta de 0015 (verificada contra producción) con una clave más.
-- Devuelve jsonb: agregar una clave no rompe a quien ya la consume.
-- ============================================================

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
    'whatsapp', v_prop.whatsapp, 'phone', v_prop.phone,
    -- La unidad activa más grande. null si todavía no hay unidades.
    'max_guests', (select max(u.capacity) from public.units u
                    where u.property_id = v_prop.id and u.is_active)
  );
end; $$;
