/**
 * Ejecuta el route handler REAL de /api/mp/webhook (TypeScript, vía jiti) con
 * sus tres dependencias reemplazadas por dobles: cliente service_role de
 * Supabase, credenciales de MP y la API de Mercado Pago. Sin red ni base.
 */
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { state, reset } from "./mocks/state.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("./mocks/", import.meta.url))
const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/supabase/admin": mocks + "admin.mjs",
    "@/lib/mp-credential": mocks + "mp-credential.mjs",
    "@/lib/mercadopago": mocks + "mercadopago.mjs",
    "@/": root + "src/",
  },
  moduleCache: false,
})
const { POST } = await jiti.import(root + "src/app/api/mp/webhook/route.ts")

const ORG = "org-a", RES = "res-1"
const call = (org = ORG, id = "pay-1", type = "payment") =>
  POST(new Request(`https://x.test/api/mp/webhook?org=${org}&type=${type}&data.id=${id}`, { method: "POST", body: "{}" }))

function scenario(status, patch = {}) {
  reset({
    reservations: [{ id: RES, organization_id: ORG, status, hold_expires_at: null }],
    payments: [{ id: "p1", organization_id: ORG, reservation_id: RES, kind: "deposit", status: "pending",
                 amount: 150000, currency: "ARS", paid_at: null, created_at: "2026-09-01" }],
    payment: { id: 1, status: "approved", transaction_amount: 150000, currency_id: "ARS", external_reference: RES },
    ...patch,
  })
}
const calls = (fn) => state.rpcCalls.filter((c) => c.fn === fn)
let logs = []
beforeEach(() => { logs = []; console.error = (...a) => logs.push(a.map(String).join(" ")) })

test("pago aprobado y verificado: acredita la seña y confirma la reserva", async () => {
  scenario("pending_payment")
  assert.equal((await call()).status, 200)
  assert.equal(state.payments[0].status, "paid")
  assert.equal(state.reservations[0].status, "confirmed")
})

test("A-02: pago tardío sobre una reserva expirada la recupera", async () => {
  scenario("expired")
  assert.equal((await call()).status, 200)
  assert.equal(calls("recover_paid_expired_reservation").length, 1)
})

test("A-02: si la fecha ya se revendió no pisa nada y deja rastro", async () => {
  scenario("expired", { rpcResults: { recover_paid_expired_reservation: { data: "UNAVAILABLE", error: null } } })
  assert.equal((await call()).status, 200)
  assert.equal(state.reservations[0].status, "expired")
  assert.ok(logs.some((l) => /ya se revendi/.test(l)))
})

test("M-07: una falla transitoria responde 500 para que Mercado Pago reintente", async () => {
  for (const patch of [{ mpThrows: "MP_503: caído" }, { failOn: "payments:select" }, { failOn: "payments:update" }, { credThrows: true }]) {
    scenario("pending_payment", patch)
    assert.equal((await call()).status, 500, JSON.stringify(patch))
    assert.equal(state.reservations[0].status, "pending_payment", "no confirma a medias")
  }
})

test("M-07: una org en la URL distinta a la de la reserva no toca nada", async () => {
  scenario("pending_payment")
  assert.equal((await call("org-b")).status, 200)
  assert.equal(state.payments[0].status, "pending")
  assert.deepEqual(state.updates, [])
})

test("un monto que no coincide no se acredita ni confirma", async () => {
  scenario("pending_payment", { payment: { id: 1, status: "approved", transaction_amount: 1, currency_id: "ARS", external_reference: RES } })
  assert.equal((await call()).status, 200)
  assert.equal(state.payments[0].status, "pending")
  assert.equal(state.reservations[0].status, "pending_payment")
})

test("A-02: un cupón de efectivo estira la retención hasta su vencimiento", async () => {
  const vence = "2026-09-13T23:59:59.000-03:00"
  const cupon = { id: 1, status: "pending", status_detail: "pending_waiting_payment", payment_type_id: "ticket",
                  date_of_expiration: vence, transaction_amount: 150000, currency_id: "ARS", external_reference: RES }
  scenario("pending_payment", { payment: cupon })
  assert.equal((await call()).status, 200)
  assert.deepEqual(calls("extend_hold_for_offline_payment").map((c) => c.args), [{ p_reservation: RES, p_until: vence }])
  assert.equal(state.payments[0].status, "pending")
  assert.equal(state.reservations[0].status, "pending_payment")

  // Si la base no pudo estirarla, Mercado Pago tiene que reintentar.
  scenario("pending_payment", { payment: cupon, rpcResults: { extend_hold_for_offline_payment: { data: null, error: { message: "db down" } } } })
  assert.equal((await call()).status, 500)
})

test("una tarjeta en revisión o un cupón sin vencimiento no estiran nada", async () => {
  for (const payment of [
    { id: 1, status: "in_process", status_detail: "pending_review_manual", payment_type_id: "credit_card",
      date_of_expiration: "2026-09-13T23:59:59.000-03:00", external_reference: RES },
    { id: 1, status: "pending", status_detail: "pending_waiting_payment", payment_type_id: "ticket",
      date_of_expiration: null, external_reference: RES },
    { id: 1, status: "pending", payment_type_id: "ticket", date_of_expiration: "no es una fecha", external_reference: RES },
  ]) {
    scenario("pending_payment", { payment })
    assert.equal((await call()).status, 200)
    assert.equal(calls("extend_hold_for_offline_payment").length, 0, JSON.stringify(payment))
  }
})

test("notificaciones que no son de pago y reintentos sobre reservas confirmadas se ignoran", async () => {
  scenario("pending_payment")
  assert.equal((await call(ORG, "9", "merchant_order")).status, 200)
  assert.deepEqual(state.updates, [])
  scenario("confirmed")
  assert.equal((await call()).status, 200)
  assert.equal(calls("transition_reservation").length, 0)
})
