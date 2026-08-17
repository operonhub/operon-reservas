-- ============================================================
-- Operon Reservas — Motor de expiración + estado público de reserva
-- ============================================================
-- NOTA (post-hoc): el `expire_stale_reservations()` de esta migración quedó
-- SUPERADO por `expire_stale_holds()` — ya existía aplicado directo en la
-- base (sin migración) desde un trabajo previo, con batching (mejor). La
-- migración 0014 lo formaliza, elimina el de acá y deja uno solo corriendo.
-- Se deja este archivo tal cual para no reescribir historial ya aplicado;
-- `_can_transition`, `public_reservation_status` y el `create_public_reservation`
-- con montos siguen vigentes.
-- ============================================================
-- Cierra el círculo de "reserva → seña → confirmación" sin intervención
-- manual:
--   1. `_can_transition` ahora admite pending/pending_payment → expired.
--   2. `expire_stale_reservations()` libera fechas y marca 'expired' las
--      reservas cuyo hold_expires_at venció sin pago aprobado. Corre por
--      pg_cron cada minuto (mismo patrón que la outbox de notificaciones
--      en 0006). El trigger de notificaciones ya existente avisa solo al
--      huésped cuando esto pasa (no hace falta código nuevo ahí).
--   3. `public_reservation_status` expone el estado verificado (post-
--      webhook) para que la web del huésped confíe en el backend y NO en
--      el query param de la redirect de Mercado Pago.
--   4. `create_public_reservation` ahora devuelve total/seña/saldo para
--      que el frontend los muestre sin otra consulta.
-- ============================================================

-- ---------- 1) Transiciones: sumar el camino a 'expired' ----------
create or replace function _can_transition(p_from reservation_status, p_to reservation_status)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'inquiry'         then p_to in ('pending','pending_payment','cancelled')
    when 'pending'         then p_to in ('pending_payment','confirmed','cancelled','expired')
    when 'pending_payment' then p_to in ('confirmed','cancelled','expired')
    when 'confirmed'       then p_to in ('completed','cancelled')
    else false   -- completed / cancelled / expired son terminales
  end;
$$;

-- ---------- 2) Motor de expiración ----------
-- Sistema (no requiere membership): sólo toca holds vencidos, nunca
-- reservas activas. Bloquea las filas candidatas con FOR UPDATE SKIP
-- LOCKED antes de tocarlas, así una confirmación (webhook) concurrente
-- sobre la MISMA fila se serializa correctamente — si el webhook ya la
-- confirmó, esta función simplemente no la vuelve a encontrar.
create or replace function expire_stale_reservations()
returns int
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_count int := 0;
begin
  -- FOR UPDATE no puede combinarse con array_agg en la misma consulta:
  -- se bloquean las filas candidatas en una subconsulta y se agregan afuera.
  select array_agg(id) into v_ids
  from (
    select id
    from public.reservations
    where status in ('pending','pending_payment')
      and hold_expires_at is not null
      and hold_expires_at < now()
    for update skip locked
  ) locked_rows;

  if v_ids is null or array_length(v_ids, 1) is null then
    return 0;
  end if;

  -- Libera el inventario retenido por esos holds.
  delete from public.unit_occupancy where reservation_id = any(v_ids);

  -- Doble check de estado en el UPDATE: sólo toca lo que seguía pendiente
  -- al momento del lock (defensa en profundidad además del FOR UPDATE).
  update public.reservations
     set status = 'expired', hold_expires_at = null
   where id = any(v_ids)
     and status in ('pending','pending_payment');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function expire_stale_reservations() from public, anon, authenticated;
grant execute on function expire_stale_reservations() to service_role;

-- Reintenta cada minuto (holds de 30' vencen con margen de sobra).
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'expire-stale-reservations';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'expire-stale-reservations',
    '* * * * *',
    'select public.expire_stale_reservations();'
  );
end $$;

-- ---------- 3) Estado público verificado (para polling del huésped) ----------
-- SOLO campos públicos: nada de email/teléfono/notas del huésped. El
-- `code` actúa como capability (igual criterio que /api/mp/checkout, que
-- ya recibe únicamente code+orgSlug sin autenticación).
create or replace function public_reservation_status(p_org_slug text, p_code text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid; v_res public.reservations; v_pay public.payments;
  v_unit_name text; v_property_name text; v_paid numeric;
begin
  select id into v_org from public.organizations where slug = p_org_slug;
  if v_org is null then raise exception 'ORG_NOT_FOUND'; end if;

  select * into v_res from public.reservations
   where organization_id = v_org and code = p_code;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;

  select u.name into v_unit_name from public.units u where u.id = v_res.unit_id;
  select p.name into v_property_name from public.properties p where p.id = v_res.property_id;

  select * into v_pay from public.payments
   where reservation_id = v_res.id and kind = 'deposit'
   order by created_at desc
   limit 1;

  v_paid := case when v_pay.status = 'paid' then v_pay.amount else 0 end;

  return jsonb_build_object(
    'code', v_res.code,
    'status', v_res.status,
    'payment_status', v_pay.status,
    'property_name', v_property_name,
    'unit_name', v_unit_name,
    'check_in', v_res.check_in,
    'check_out', v_res.check_out,
    'guests_count', v_res.guests_count,
    'total_amount', v_res.total_amount,
    'deposit_amount', v_res.deposit_amount,
    'paid_amount', case when v_pay.id is null then null else v_paid end,
    'remaining_amount', case when v_res.total_amount is not null
                              then v_res.total_amount - coalesce(v_paid, 0)
                              else null end,
    'currency', v_res.currency,
    'hold_expires_at', v_res.hold_expires_at
  );
end;
$$;

revoke execute on function public_reservation_status(text, text) from public;
grant execute on function public_reservation_status(text, text) to anon, authenticated;

-- ---------- 4) create_public_reservation: devolver montos ----------
-- Misma lógica que 0005 (precio ya se calcula dentro de `_book`); sólo
-- cambia qué se devuelve al frontend.
create or replace function create_public_reservation(
  p_org_slug text, p_property_slug text, p_unit_id uuid,
  p_check_in date, p_check_out date, p_guests int,
  p_full_name text, p_email text, p_phone text, p_notes text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prop public.properties; v_guest uuid; v_res public.reservations;
begin
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
