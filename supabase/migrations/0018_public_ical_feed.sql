-- ============================================================
-- Operon Reservas — feed iCal público por unidad (exportar)
-- ============================================================
-- Cada unidad expone una URL pública (no adivinable: la clave es el uuid de
-- la unidad, mismo modelo que el código de reserva) con sus fechas ocupadas
-- en formato iCal, para que Booking/Airbnb la lean y bloqueen su calendario.
-- Sólo expone rangos de fechas — nunca huésped, precio ni motivo de bloqueo.
-- ============================================================

create or replace function public_ical_feed(p_unit_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit record;
  v_ranges jsonb;
begin
  select u.id, u.name as unit_name, p.name as property_name
    into v_unit
  from public.units u
  join public.properties p on p.id = u.property_id
  where u.id = p_unit_id;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', o.id,
               'start_date', lower(o.during),
               'end_date', upper(o.during)
             )
             order by lower(o.during)
           ),
           '[]'::jsonb
         )
    into v_ranges
  from public.unit_occupancy o
  where o.unit_id = p_unit_id;

  return jsonb_build_object(
    'found', true,
    'unit_name', v_unit.unit_name,
    'property_name', v_unit.property_name,
    'ranges', v_ranges
  );
end;
$$;

revoke execute on function public_ical_feed(uuid) from public;
grant execute on function public_ical_feed(uuid) to anon, authenticated;
