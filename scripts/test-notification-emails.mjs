import assert from "node:assert/strict"
import {
  escapeHtml,
  renderReservationEmail,
} from "../supabase/functions/_shared/reservation-email.ts"

const payload = {
  reservation_code: "R-ABC123",
  unit_name: "Loft",
  property_name: "Cabañas <script>",
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
assert.equal(escapeHtml('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;")

console.log("notification email templates: ok")
