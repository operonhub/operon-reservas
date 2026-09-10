/**
 * El route handler real de /api/mp/checkout con Supabase, credenciales, la API
 * de MP y el límite de intentos simulados.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { state, reset } from "./mocks/state.mjs"

process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-test"
const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("./mocks/", import.meta.url))
const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/supabase/admin": mocks + "admin.mjs",
    "@/lib/mp-credential": mocks + "mp-credential.mjs",
    "@/lib/mercadopago": mocks + "mercadopago.mjs",
    "@/lib/rate-limit": mocks + "rate-limit.mjs",
    "@/": root + "src/",
  },
  moduleCache: false,
})
const { POST } = await jiti.import(root + "src/app/api/mp/checkout/route.ts")

const checkout = (body = { code: "R-1", orgSlug: "alto-cielo" }) =>
  POST(new Request("https://x.test/api/mp/checkout", { method: "POST", body: JSON.stringify(body) }))
function scenario(patch = {}) {
  reset({
    organizations: [{ id: "org-a", name: "Alto Cielo", slug: "alto-cielo" }],
    reservations: [{ id: "res-1", organization_id: "org-a", code: "R-1", status: "pending", total_amount: 300000, deposit_amount: 150000, currency: "ARS", guest_id: null }],
    payments: [],
    ...patch,
  })
}
const rpc = (fn) => state.rpcCalls.filter((c) => c.fn === fn)

test("A-03: la vuelta del pago es siempre /pago, aunque manden un returnUrl", async () => {
  scenario()
  const res = await checkout({ code: "R-1", orgSlug: "alto-cielo", returnUrl: "https://atacante.test/phish" })
  assert.equal(res.status, 200)
  const back = state.preferences[0].back_urls.success
  assert.equal(back, "https://reservas.test/pago?code=R-1&org=alto-cielo")
})

test("A-03: la retención se estira por la RPC con tope", async () => {
  scenario()
  await checkout()
  assert.equal(rpc("extend_checkout_hold").length, 1)
  assert.equal(rpc("extend_checkout_hold")[0].args.p_reservation, "res-1")
})

test("sin la 0025 aplicada, la retención se estira igual con el método anterior", async () => {
  scenario({ rpcResults: { extend_checkout_hold: { data: null, error: { message: "function does not exist" } } } })
  await checkout()
  assert.ok(state.updates.some((u) => u.table === "reservations" && u.patch.hold_expires_at))
})

test("A-03: con el cupo de intentos agotado responde 429 sin tocar nada", async () => {
  scenario({ withinLimit: false })
  const res = await checkout()
  assert.equal(res.status, 429)
  assert.deepEqual(state.rpcCalls, [])
  assert.deepEqual(state.payments, [])
})

test("M-06: un segundo pedido reutiliza la seña pendiente y su link", async () => {
  scenario()
  await checkout()
  state.payments[0].mp_init_point = "https://mp.test/init"
  const res = await checkout()
  assert.equal((await res.json()).init_point, "https://mp.test/init")
  assert.equal(state.payments.length, 1)
  assert.equal(state.preferences.length, 1)
})
