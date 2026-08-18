-- Bug preexistente: transition_reservation exige is_member_of(), que se basa
-- en auth.uid() — bajo service_role (backend, sin sesión) auth.uid() es NULL,
-- así que la llamada SIEMPRE fallaba con FORBIDDEN. Efecto observado: al
-- crear el checkout de MP, /api/mp/checkout intenta mover pending→pending_payment
-- y falla en silencio (la reserva se queda en "pending" aunque ya tenga un
-- pago pendiente creado). No rompe la confirmación real — el webhook igual
-- confirma reservas en 'pending' o 'pending_payment' — pero el estado que ve
-- el propietario en el panel queda desactualizado ("Pendiente" en vez de
-- "Esperando seña") mientras se espera el pago.
create or replace function transition_reservation(p_reservation uuid, p_to reservation_status)
returns reservation_status language plpgsql security definer set search_path = '' as $$
declare v public.reservations;
begin
  select * into v from public.reservations where id = p_reservation;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.is_member_of(v.organization_id) or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN';
  end if;
  if not public._can_transition(v.status, p_to) then raise exception 'INVALID_TRANSITION'; end if;

  if public.holds_inventory(p_to) and not public.holds_inventory(v.status) then
    begin
      insert into public.unit_occupancy
        (organization_id, unit_id, during, kind, reservation_id, created_by)
      values (v.organization_id, v.unit_id, daterange(v.check_in, v.check_out, '[)'),
              'reservation', v.id, auth.uid());
    exception when exclusion_violation then raise exception 'UNAVAILABLE'; end;
  elsif public.holds_inventory(v.status) and not public.holds_inventory(p_to) then
    delete from public.unit_occupancy where reservation_id = v.id;
  end if;

  update public.reservations
     set status = p_to,
         hold_expires_at = case when p_to in ('confirmed','completed') then null else hold_expires_at end
   where id = v.id;
  return p_to;
end; $$;
