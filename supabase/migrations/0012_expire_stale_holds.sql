-- ============================================================
-- Operon Reservas — Expiración de retenciones (holds)
-- ============================================================
-- create_public_reservation (0003) retiene la unidad con hold_expires_at,
-- pero hasta acá nada leía esa columna: una reserva web abandonada
-- bloqueaba la unidad para siempre. Ahora que hay pagos reales de por
-- medio (Etapa 7), esto es más urgente.
--
-- Diseño espejo de la outbox de notificaciones (0006):
--   * SKIP LOCKED  → dos ejecuciones simultáneas no se pisan.
--   * pg_cron      → dispara el barrido cada 5 minutos.
--   * El UPDATE de status dispara reservations_enqueue_notification (0006)
--     automáticamente, así que el aviso al huésped sale solo.
--
-- 'pending' (retención inicial, antes de pagar) y 'pending_payment' (ya
-- yendo al checkout de Mercado Pago) son AMBOS elegibles: pending_payment
-- recibe su propio hold_expires_at fresco de 15' al crear la preferencia
-- de pago (api/mp/checkout), así que si vence ahí también significa que
-- el huésped abandonó de verdad.
-- ============================================================

-- El barrido filtra por hold_expires_at; sin índice sería un seq scan
-- sobre toda la tabla de reservas cada 5 minutos. Parcial porque la
-- enorme mayoría de las filas tiene hold_expires_at nulo (carga manual,
-- reservas ya confirmadas).
create index if not exists reservations_hold_expiry_idx
  on reservations (hold_expires_at)
  where hold_expires_at is not null;

create or replace function expire_stale_holds(p_limit int default 200)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_expired int := 0;
begin
  with expired as (
    select r.id
    from public.reservations r
    where r.hold_expires_at is not null
      and r.hold_expires_at <= now()
      and r.status in ('pending', 'pending_payment')
    order by r.hold_expires_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ),
  -- CTE modificadora: se ejecuta aunque no se la referencie después.
  -- Libera la fecha en la única fuente de verdad de disponibilidad.
  released as (
    delete from public.unit_occupancy o
    using expired e
    where o.reservation_id = e.id
    returning o.reservation_id
  )
  update public.reservations r
     set status = 'expired',
         hold_expires_at = null
    from expired e
   where r.id = e.id;

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

-- Sólo el cron (postgres) y service_role. Ningún usuario del panel ni
-- anon puede expirar reservas ajenas con esto.
revoke execute on function public.expire_stale_holds(int) from public, anon, authenticated;
grant execute on function public.expire_stale_holds(int) to service_role;

-- Mismo intervalo que el reintento de la outbox (0006): un hold de 15'
-- se libera entonces entre los 15' y los 20'.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
  where jobname = 'expire-stale-holds';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'expire-stale-holds',
    '*/5 * * * *',
    'select public.expire_stale_holds();'
  );
end;
$$;
