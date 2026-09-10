/**
 * Límite de intentos del lado de la app (0025): las server actions públicas
 * reales, con Supabase y las cabeceras de Vercel simulados.
 */
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { state, reset } from "./mocks-publico/state.mjs"

process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-test"
const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("./mocks-publico/", import.meta.url))
const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/supabase/admin": mocks + "admin.mjs",
    "@/lib/supabase/server": mocks + "server.mjs",
    "next/headers": mocks + "next-headers.mjs",
    "@/": root + "src/",
  },
  moduleCache: false,
})
const { bookPublic } = await jiti.import(root + "src/app/(public)/reservar/[slug]/actions.ts")
const { getReservationStatus } = await jiti.import(root + "src/app/(public)/pago/actions.ts")
const { clientIp, withinLimit, RATE_LIMITED_MESSAGE } = await jiti.import(root + "src/lib/rate-limit.ts")

const booking = { orgSlug: "alto-cielo", unitId: "u1", checkIn: "2027-03-01", checkOut: "2027-03-03", guests: 2, fullName: "Ana", email: "", phone: "", notes: "" }
const fns = () => state.calls.map((c) => `${c.client}:${c.fn}`)
beforeEach(() => reset())

test("con el cupo agotado, la reserva pública no llega a crearse", async () => {
  reset({ withinLimit: false })
  assert.deepEqual(await bookPublic(booking), { ok: false, error: RATE_LIMITED_MESSAGE })
  assert.deepEqual(fns(), ["service_role:rate_limit_hit"])
})

test("dentro del cupo, cuenta por la IP del huésped y reserva como service_role", async () => {
  const res = await bookPublic(booking)
  assert.equal(res.ok, true)
  assert.deepEqual(fns(), ["service_role:rate_limit_hit", "service_role:create_public_reservation"])
  assert.equal(state.calls[0].args.p_subject, "203.0.113.7")
  assert.equal(state.calls[0].args.p_bucket, "reserva_publica")
})

test("con la cookie de demo nunca se usa service_role para reservar", async () => {
  reset({ demo: true })
  await bookPublic(booking)
  assert.ok(fns().includes("anon:create_public_reservation"))
  assert.ok(!fns().includes("service_role:create_public_reservation"))
})

test("la consulta de estado avisa que es un tope, no que la reserva no existe", async () => {
  reset({ withinLimit: false })
  const res = await getReservationStatus("alto-cielo", "R-ABC123")
  assert.equal(res.ok, false)
  assert.equal(res.rateLimited, true)
})

test("si el contador falla, deja pasar: el límite no puede frenar una reserva legítima", async () => {
  reset({ rpcError: { message: "function rate_limit_hit does not exist" } })
  assert.equal(await withinLimit("reservaPublica", "203.0.113.7"), true)
})

test("la IP sale de x-real-ip, o del primer salto de x-forwarded-for", () => {
  assert.equal(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" })), "1.1.1.1")
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" })), "2.2.2.2")
  assert.equal(clientIp(new Headers()), null)
})
