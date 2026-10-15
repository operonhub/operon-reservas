/**
 * Las server actions de reservas (código real, vía jiti) con la sesión y
 * Supabase simulados: validan antes de llegar a la base, respetan el rol para
 * eliminar, traducen los errores de la base y no muestran mensajes técnicos.
 */
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { state } from "./mocks-panel/state.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("./mocks-panel/", import.meta.url))
const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/auth": mocks + "auth.mjs",
    "@/lib/supabase/server": mocks + "supabase-server.mjs",
    "next/cache": mocks + "next-cache.mjs",
    "next/headers": mocks + "next-headers.mjs",
    "@/": root + "src/",
  },
  moduleCache: false,
})
const actions = await jiti.import(root + "src/app/(panel)/reservas/actions.ts")
const { DELETE_RESERVATION_FORBIDDEN_MESSAGE } = await jiti.import(root + "src/lib/roles.ts")

const form = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f }
const valid = {
  id: "res-1", unit_id: "unit-1", check_in: "2027-03-10", check_out: "2027-03-12", guests: "2",
  full_name: "Ana Pérez", email: "ana@e.test", phone: "", notes: "",
}

beforeEach(() => {
  state.role = "owner"
  state.dbCalls = []
  state.rpcResults = {}
  state.lastRpc = null
})

test("eliminar: staff recibe el aviso y no llega a la base; owner y admin sí", async () => {
  state.role = "staff"
  assert.deepEqual(await actions.deleteReservation("res-1"), { ok: false, error: DELETE_RESERVATION_FORBIDDEN_MESSAGE })
  assert.deepEqual(state.dbCalls, [])
  for (const role of ["owner", "admin"]) {
    state.role = role
    state.dbCalls = []
    assert.deepEqual(await actions.deleteReservation("res-1"), { ok: true })
    assert.deepEqual(state.lastRpc, { fn: "delete_reservation", args: { p_reservation: "res-1" } })
  }
  assert.deepEqual(await actions.deleteReservation(""), { ok: false, error: "No se pudo identificar la reserva." })
})

test("los errores de la base se traducen y los desconocidos no se muestran crudos", async () => {
  const cases = [
    ["HAS_PAYMENTS", /pagos registrados.*Cancelala/],
    ["HAS_OPEN_CHECKOUT", /link de pago de Mercado Pago abierto/],
    ["FORBIDDEN", /No tenés permiso/],
    ["NOT_FOUND", /ya la hayan eliminado/],
    ["relation \"x\" does not exist (código técnico)", /^No se pudo completar\. Probá de nuevo\.$/],
  ]
  for (const [message, expected] of cases) {
    state.rpcResults = { delete_reservation: { data: null, error: { message } } }
    const res = await actions.deleteReservation("res-1")
    assert.equal(res.ok, false)
    assert.match(res.error, expected, message)
    assert.ok(!res.error.includes("relation"), "no filtra el mensaje técnico")
  }
})

test("editar: valida antes de llegar a la base", async () => {
  const bad = [
    [{ id: "" }, /identificar/],
    [{ unit_id: "" }, /unidad/],
    [{ full_name: "  " }, /nombre/],
    [{ check_in: "" }, /fechas/],
    [{ check_out: "2027-03-10" }, /posterior/],
    [{ check_out: "2027-03-09" }, /posterior/],
    [{ guests: "0" }, /al menos 1/],
    [{ guests: "abc" }, /al menos 1/],
  ]
  for (const [patch, expected] of bad) {
    const res = await actions.updateReservation(form({ ...valid, ...patch }))
    assert.equal(res.ok, false, JSON.stringify(patch))
    assert.match(res.error, expected, JSON.stringify(patch))
  }
  assert.deepEqual(state.dbCalls, [], "ninguna llegó a la base")
})

test("editar: manda los datos a la función de la base y devuelve el saldo", async () => {
  state.rpcResults = {
    update_reservation: {
      data: { changed: true, code: "R-AB12CD", total_amount: 400000, deposit_amount: 200000, paid_amount: 100000, balance: 300000, currency: "ARS", no_price: false },
      error: null,
    },
  }
  const res = await actions.updateReservation(form({ ...valid, email: " ", phone: " +54 9 11 ", notes: "Llega tarde", guests: "3.7" }))
  assert.deepEqual(state.lastRpc, {
    fn: "update_reservation",
    args: {
      p_reservation: "res-1", p_unit: "unit-1", p_check_in: "2027-03-10", p_check_out: "2027-03-12",
      p_guests: 3, p_full_name: "Ana Pérez", p_email: null, p_phone: "+54 9 11", p_notes: "Llega tarde",
    },
  })
  assert.deepEqual(res, {
    ok: true,
    summary: { changed: true, code: "R-AB12CD", total: 400000, deposit: 200000, paid: 100000, balance: 300000, currency: "ARS", noPrice: false },
  })
})

test("editar: sin tarifa el total vuelve vacío; los rechazos de la base salen en criollo", async () => {
  state.rpcResults = { update_reservation: { data: { changed: true, code: "R-1", total_amount: null, balance: null, paid_amount: 0, currency: "ARS", no_price: true }, error: null } }
  const sinTarifa = await actions.updateReservation(form(valid))
  assert.equal(sinTarifa.summary.total, null)
  assert.equal(sinTarifa.summary.balance, null)
  assert.equal(sinTarifa.summary.noPrice, true)

  for (const [message, expected] of [
    ["UNAVAILABLE", /ya están ocupadas/],
    ["OVER_CAPACITY", /supera la capacidad/],
    ["MIN_NIGHTS:3", /estadía mínima es de 3 noches/],
    ["NOT_EDITABLE", /cancelada o expirada/],
    ["UNIT_NOT_FOUND", /unidad/],
  ]) {
    state.rpcResults = { update_reservation: { data: null, error: { message } } }
    const res = await actions.updateReservation(form(valid))
    assert.equal(res.ok, false)
    assert.match(res.error, expected, message)
  }
})

test("estado: cancelar manda p_notify según la casilla; sin opción avisa como siempre", async () => {
  await actions.transitionReservation("res-1", "cancelled")
  assert.equal(state.lastRpc.args.p_notify, true)
  await actions.transitionReservation("res-1", "cancelled", { notifyGuest: false })
  assert.deepEqual(state.lastRpc, { fn: "transition_reservation", args: { p_reservation: "res-1", p_to: "cancelled", p_notify: false } })
  await actions.transitionReservation("res-1", "confirmed", { notifyGuest: true })
  assert.equal(state.lastRpc.args.p_to, "confirmed")

  state.rpcResults = { transition_reservation: { data: null, error: { message: "INVALID_TRANSITION" } } }
  assert.match((await actions.transitionReservation("res-1", "confirmed")).error, /no está permitida/)
  state.rpcResults = { transition_reservation: { data: null, error: { message: "UNAVAILABLE" } } }
  assert.match((await actions.transitionReservation("res-1", "confirmed")).error, /fechas ya están ocupadas/)
})

test("historial: solo dueño o administrador; mapea lo que devuelve la base", async () => {
  state.role = "staff"
  assert.equal((await actions.getReservationAudit()).ok, false)
  assert.deepEqual(state.dbCalls, [])

  state.role = "admin"
  state.rpcResults = {
    reservation_audit_log: {
      data: [{ at: "2027-01-01T12:00:00Z", action: "deleted", reservation_id: "r1", reservation_code: "R-1", actor_name: "Ana", detail: { guest: "Prueba" } }],
      error: null,
    },
  }
  const res = await actions.getReservationAudit("r1")
  assert.deepEqual(state.lastRpc, { fn: "reservation_audit_log", args: { p_org: "org-a", p_reservation: "r1", p_limit: 100 } })
  assert.equal(res.ok, true)
  assert.deepEqual(res.entries, [{ at: "2027-01-01T12:00:00Z", action: "deleted", reservation_id: "r1", reservation_code: "R-1", actor_name: "Ana", detail: { guest: "Prueba" } }])
})

test("ingreso y salida van por la función de la base, no por un update directo", async () => {
  state.dbCalls = []
  assert.deepEqual(await actions.recordReservationMovement("res-1", "checkin"), { ok: true })
  assert.deepEqual(state.lastRpc, { fn: "record_reservation_movement", args: { p_reservation: "res-1", p_movement: "checkin" } })
  assert.ok(!state.dbCalls.some((c) => c.startsWith("from:")), "no toca la tabla directo")

  state.rpcResults = { record_reservation_movement: { data: null, error: { message: "ALREADY_RECORDED" } } }
  assert.match((await actions.recordReservationMovement("res-1", "checkin")).error, /ingreso ya estaba registrado/)
  assert.match((await actions.recordReservationMovement("res-1", "checkout")).error, /salida ya estaba registrada/)
  state.rpcResults = { record_reservation_movement: { data: null, error: { message: "NOT_EDITABLE" } } }
  assert.match((await actions.recordReservationMovement("res-1", "checkin")).error, /cancelada o expirada/)
  assert.equal((await actions.recordReservationMovement("res-1", "otro")).ok, false)
})

test("precio previo: el mismo simulador de tarifas; una noche sin precio deja el total vacío", async () => {
  const input = { unitId: "unit-1", checkIn: "2027-03-10", checkOut: "2027-03-12", guests: 2 }
  state.rpcResults = { simulate_price: { data: { total: 200000, currency: "ARS", min_nights: 1, breakdown: [{ price: 100000 }, { price: 100000 }] }, error: null } }
  assert.deepEqual(await actions.previewReservationPrice(input), { ok: true, total: 200000, currency: "ARS", nights: 2, minNights: 1 })
  state.rpcResults = { simulate_price: { data: { total: 100000, currency: "ARS", min_nights: 3, breakdown: [{ price: 100000 }, { price: null }] }, error: null } }
  assert.deepEqual(await actions.previewReservationPrice(input), { ok: true, total: null, currency: "ARS", nights: 2, minNights: 3 })

  state.dbCalls = []
  for (const bad of [{ guests: 0 }, { checkOut: "2027-03-10" }, { unitId: "" }]) {
    assert.equal((await actions.previewReservationPrice({ ...input, ...bad })).ok, false)
  }
  assert.deepEqual(state.dbCalls, [])
})
