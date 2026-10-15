/**
 * Reglas de editar, cancelar, reabrir y eliminar una reserva, y cómo se
 * cuentan en pantalla (lib/reservation-rules). Lógica pura.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

// El módulo importa otros sin extensión: se carga con el mismo cargador que las acciones.
const root = fileURLToPath(new URL("../../", import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { "@/": root + "src/" }, moduleCache: false })
const {
  balanceMessage, deleteBlocker, describeAudit, isEditableStatus, needsConfirmation,
  offersGuestEmail, paidTotal, toAuditEntries, transitionLabel,
} = await jiti.import(root + "src/lib/reservation-rules.ts")

test("solo cancelada y expirada no se editan", () => {
  for (const s of ["inquiry", "pending", "pending_payment", "confirmed", "completed"]) assert.equal(isEditableStatus(s), true, s)
  for (const s of ["cancelled", "expired"]) assert.equal(isEditableStatus(s), false, s)
})

test("lo cobrado son solo los pagos acreditados", () => {
  assert.equal(paidTotal([]), 0)
  assert.equal(paidTotal([
    { amount: 100, status: "paid" }, { amount: 50, status: "pending" },
    { amount: 70, status: "failed" }, { amount: 30, status: "refunded" }, { amount: 25, status: "paid" },
  ]), 125)
})

test("eliminar: con pagos acreditados o reintegrados no; con un link de pago abierto tampoco; con nada, sí", () => {
  assert.equal(deleteBlocker([], false), null)
  assert.equal(deleteBlocker([{ status: "pending" }, { status: "failed" }], false), null)
  assert.equal(deleteBlocker([{ status: "paid" }], false), "payments")
  assert.equal(deleteBlocker([{ status: "refunded" }], false), "payments")
  assert.equal(deleteBlocker([{ status: "pending" }], true), "checkout")
  // Si hay plata, ese es el motivo que se cuenta primero.
  assert.equal(deleteBlocker([{ status: "paid" }], true), "payments")
})

test("botones: reabrir y cancelar se llaman por su nombre y piden confirmación", () => {
  assert.equal(transitionLabel("completed", "confirmed"), "Reabrir")
  assert.equal(transitionLabel("confirmed", "cancelled"), "Cancelar reserva")
  assert.equal(transitionLabel("completed", "cancelled"), "Cancelar reserva")
  assert.equal(transitionLabel("pending", "confirmed"), "Confirmada")
  assert.equal(transitionLabel("confirmed", "completed"), "Completada")
  assert.equal(needsConfirmation("confirmed", "cancelled"), true)
  assert.equal(needsConfirmation("completed", "confirmed"), true)
  assert.equal(needsConfirmation("pending", "confirmed"), false)
  assert.equal(needsConfirmation("confirmed", "completed"), false)
})

test("el aviso por mail se ofrece solo al cancelar, con mail y si no estaba completada", () => {
  assert.equal(offersGuestEmail("confirmed", "cancelled", "a@e.test"), true)
  assert.equal(offersGuestEmail("pending", "cancelled", "a@e.test"), true)
  assert.equal(offersGuestEmail("completed", "cancelled", "a@e.test"), false, "cerrar o corregir un cierre no es una novedad")
  assert.equal(offersGuestEmail("confirmed", "cancelled", null), false)
  assert.equal(offersGuestEmail("confirmed", "cancelled", "  "), false)
  assert.equal(offersGuestEmail("completed", "confirmed", "a@e.test"), false)
})

test("el saldo después de editar: a cobrar, al día, cobrado de más o sin tarifa", () => {
  assert.deepEqual(balanceMessage(400000, 100000, "ARS").tone, "due")
  assert.match(balanceMessage(400000, 100000, "ARS").text, /Saldo a cobrar: .*300\.000/)
  assert.equal(balanceMessage(100000, 100000, "ARS").tone, "even")
  const over = balanceMessage(40000, 100000, "ARS")
  assert.equal(over.tone, "over")
  assert.match(over.text, /60\.000.* de más/)
  assert.match(over.text, /reintegro lo gestionás vos/)
  assert.equal(balanceMessage(null, 0, "ARS").tone, "unknown")
})

test("el historial se lee en criollo", () => {
  const entry = (action, detail) => ({ at: "2027-01-01T12:00:00Z", action, reservation_id: "r", reservation_code: "R-1", actor_name: "Ana", detail })
  assert.equal(
    describeAudit(entry("updated", { unit: { from: "A", to: "B" }, guests: { from: 2, to: 3 }, total: { from: 200000, to: null }, notes: true })),
    "Editó la reserva: cabaña A → B, huéspedes 2 → 3, total $ 200.000 → sin total, observaciones.".replace("$ ", "$ "))
  assert.match(describeAudit(entry("updated", { check_in: { from: "2027-03-10", to: "2027-03-12" } })), /ingreso .* → .*/)
  assert.equal(describeAudit(entry("updated", {})), "Editó la reserva.")
  assert.match(describeAudit(entry("cancelled", { from: "confirmed", paid_amount: 100000, guest_notified: true })), /Canceló la reserva \(estaba Confirmada\)\. Tenía .*100\.000.* cobrados\. Se avisó al huésped\./)
  assert.match(describeAudit(entry("cancelled", { from: "completed", paid_amount: 0, guest_notified: false })), /No se avisó al huésped/)
  assert.equal(describeAudit(entry("reopened", { from: "completed", to: "confirmed" })), "Reabrió la reserva: de Completada volvió a Confirmada.")
  const deleted = describeAudit(entry("deleted", { guest: "Prueba", unit: "Cabaña A", check_in: "2027-03-10", check_out: "2027-03-12", status: "completed" }))
  assert.match(deleted, /^Eliminó la reserva de Prueba · Cabaña A · .* → .* \(estaba Completada\)\.$/)
})

test("las filas del historial se arman aunque falte el detalle", () => {
  assert.deepEqual(toAuditEntries(null), [])
  assert.deepEqual(toAuditEntries(undefined), [])
  const [e] = toAuditEntries([{ at: "x", action: "deleted", reservation_id: "r", reservation_code: "R-1", actor_name: "Ana", detail: null }])
  assert.deepEqual(e.detail, {})
})
