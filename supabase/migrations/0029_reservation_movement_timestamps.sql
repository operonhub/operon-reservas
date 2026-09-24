-- ============================================================
-- 0029 — Seguimiento operativo mínimo de ingreso y salida
-- ============================================================
-- Los horarios configurados en properties son la ventana esperada. Estos
-- campos guardan el momento real que el equipo registra desde el panel.
alter table public.reservations
  add column if not exists checked_in_at  timestamptz,
  add column if not exists checked_out_at timestamptz;

create index if not exists reservations_checked_in_idx
  on public.reservations (organization_id, checked_in_at)
  where checked_in_at is not null;

create index if not exists reservations_checked_out_idx
  on public.reservations (organization_id, checked_out_at)
  where checked_out_at is not null;
