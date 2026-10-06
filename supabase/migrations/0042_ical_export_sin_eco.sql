-- ============================================================
-- 0042 — El link de calendario no le devuelve a cada plataforma sus fechas
-- ============================================================
-- Qué pasaba (Cabañas 4 Elementos, 2026-10-06): el link de exportación
-- publicaba TODO unit_occupancy, también los bloqueos que habíamos importado
-- de Booking. Booking importa ese link cada ~2 h y, a las fechas que le llegan
-- por un calendario importado, deja de publicarlas en su propio export. El
-- ciclo completo:
--
--   1. Operon importa de Booking la reserva R y bloquea la fecha.
--   2. Operon le exporta R a Booking.
--   3. Booking la marca "viene del calendario importado" y la saca de su feed.
--   4. Operon ve que R ya no está y (pasado el margen de 0041) la libera.
--   5. Operon deja de exportarla; Booking vuelve a publicarla; vuelve al paso 1.
--
-- Comprobado leyendo los dos lados a la vez: en las 4 unidades Booking
-- publicaba exactamente las fechas que Operon NO le estaba mandando, y un
-- calendario vacío donde Operon le mandaba todo. No es un feed inestable de
-- Booking: es el eco de nuestro propio export.
--
-- Cambio: public_ical_feed recibe a quién va dirigido el link.
--   * p_for = 'booking' | 'airbnb'  → reservas y bloqueos de Operon + lo
--     importado de la OTRA plataforma (para que Operon haga de puente entre
--     las dos). Nunca lo importado de la misma.
--   * p_for nulo (el link que ya está pegado en las plataformas) → solo
--     reservas y bloqueos de Operon, nada importado. Para un complejo con una
--     sola plataforma es exactamente lo correcto y no hay que cambiar ningún
--     link; uno con las dos tiene que usar el link de cada plataforma (el
--     panel pasa a dar uno para cada una).
-- ============================================================

-- Cambia la firma: hay que dropear para que no queden dos versiones y
-- PostgREST no sepa cuál llamar. La ruta desplegada llama con dos argumentos
-- y sigue funcionando contra la nueva (p_for tiene default).
drop function if exists public.public_ical_feed(uuid, text);

create function public.public_ical_feed(p_unit_id uuid, p_token text, p_for text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit record;
  v_ranges jsonb;
  v_for text := lower(nullif(btrim(coalesce(p_for, '')), ''));
begin
  if v_for is not null and v_for not in ('airbnb', 'booking') then
    v_for := null;
  end if;

  select u.id, u.name as unit_name, p.name as property_name
    into v_unit
  from public.units u
  join public.properties p on p.id = u.property_id
  where u.id = p_unit_id and u.ical_token = p_token;

  -- Unidad inexistente y token equivocado responden igual: no confirma qué
  -- uuid existe.
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
  where o.unit_id = p_unit_id
    and upper(o.during) >= current_date - 30
    and (o.external_source is null
         or (v_for is not null and o.external_source <> v_for));

  return jsonb_build_object(
    'found', true,
    'unit_name', v_unit.unit_name,
    'property_name', v_unit.property_name,
    'ranges', v_ranges
  );
end;
$$;

revoke execute on function public.public_ical_feed(uuid, text, text) from public;
grant execute on function public.public_ical_feed(uuid, text, text) to anon, authenticated;
