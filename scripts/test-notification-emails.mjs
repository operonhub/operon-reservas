import assert from "node:assert/strict"
import {
  escapeHtml,
  renderReservationEmail,
} from "../supabase/functions/_shared/reservation-email.ts"

const payload = {
  reservation_code: "R-ABC123",
  unit_name: "Loft",
  property_name: "Cabañas <script>",
  guest_name: "Tomás <script>",
  check_in: "2026-09-10",
  check_out: "2026-09-13",
  guests_count: 2,
  total_amount: 180000,
  deposit_amount: 54000,
  currency: "ARS",
  new_status: "confirmed",
}

const admin = renderReservationEmail({
  id: "event-1",
  event_type: "reservation_created_admin",
  reservation_status: "pending",
  recipient_email: "admin@example.com",
  idempotency_key: "reservation-created-admin:1",
  payload,
})
assert.match(admin.subject, /R-ABC123/)
assert.match(admin.html, /Nueva reserva/)
assert.doesNotMatch(admin.html, /<script>/)

const guest = renderReservationEmail({
  id: "event-2",
  event_type: "reservation_status_guest",
  reservation_status: "confirmed",
  recipient_email: "tomas@example.com",
  idempotency_key: "reservation-status-guest:1:pending:confirmed",
  payload,
})
assert.equal(guest.subject, "Reserva confirmada: reserva R-ABC123")
assert.match(guest.html, /54\.000/)

const confirmedAdmin = renderReservationEmail({
  id: "event-3",
  event_type: "reservation_confirmed_admin",
  reservation_status: "confirmed",
  recipient_email: "admin@example.com",
  idempotency_key: "reservation-confirmed-admin:1",
  payload,
})
assert.match(confirmedAdmin.subject, /R-ABC123/)
assert.match(confirmedAdmin.html, /Nueva reserva confirmada/)
assert.match(confirmedAdmin.html, /126\.000/) // saldo: 180000 - 54000
assert.doesNotMatch(confirmedAdmin.html, /<script>/)

const orphaned = renderReservationEmail({
  id: "event-4",
  event_type: "payment_orphaned_admin",
  reservation_status: "expired",
  recipient_email: "admin@example.com",
  idempotency_key: "payment-orphaned-admin:1",
  payload: {
    ...payload,
    guest_email: "huesped@example.com",
    guest_phone: "+54 9 11 5555-0000",
    paid_amount: 54000,
  },
})
assert.match(orphaned.subject, /R-ABC123/)
assert.match(orphaned.subject, /Requiere acción/)
assert.match(orphaned.html, /huesped@example\.com/)
assert.match(orphaned.html, /5555-0000/)
assert.match(orphaned.html, /54\.000/)
assert.match(orphaned.html, /devolvele el pago/)
assert.doesNotMatch(orphaned.html, /<script>/)

// Un importe desconocido no se muestra como $ 0.
const orphanedNoAmount = renderReservationEmail({
  id: "event-5",
  event_type: "payment_orphaned_admin",
  reservation_status: "expired",
  recipient_email: "admin@example.com",
  idempotency_key: "payment-orphaned-admin:2",
  payload: { ...payload, paid_amount: null },
})
assert.doesNotMatch(orphanedNoAmount.html, /\$\s*0(?!\d)/)

assert.equal(escapeHtml('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;")

console.log("notification email templates: ok")
