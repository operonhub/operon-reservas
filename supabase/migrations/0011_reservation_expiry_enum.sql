-- ============================================================
-- Operon Reservas — Estado 'expired' de reserva
-- ============================================================
-- Nuevo valor de enum en su PROPIA migración: Postgres no permite usar un
-- valor de enum recién agregado dentro de la misma transacción que lo crea.
-- La lógica que lo USA (motor de expiración, RPC pública, etc.) va en la
-- migración siguiente (0012), ya con el valor comprometido.
-- ============================================================

-- Sintaxis idempotente nativa (PG12+): evita el error si ya existe y evita
-- envolver el ALTER TYPE en un DO block (no soportado para ADD VALUE).
alter type reservation_status add value if not exists 'expired';
