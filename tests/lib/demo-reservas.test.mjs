/**
 * Editar, cancelar y eliminar en la demo (0046): mismas reglas que la base, y
 * el calendario de la demo lo refleja.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  EMPTY_DEMO_STATE,
  applyDemoDelete,
  applyDemoManualReservation,
  applyDemoTransition,
  applyDemoUpdate,
  demoStayPrice,
  parseDemoState,
  serializeDemoState,
  createDemoClient,
} from "../../src/lib/demo/fixtures.ts"

const manual = (over = {}) => ({
  unitId: "unit-1", fullName: "Nueva Persona", email: null, phone: null,
  checkIn: "2026-10-01", checkOut: "2026-10-04", guests: 2, status: "confirmed", notes: null, ...over,
})
const edit = (over = {}) => ({
  unitId: "unit-3", checkIn: "2026-09-14", checkOut: "2026-09-18", guests: 5,
  fullName: "Paula Méndez", email: "paula@ejemplo.com", phone: "+5493515550103", notes: null, ...over,
})
const reservationsOf = async (state) => (await createDemoClient(state).from("reservations")).data
const occupancyOf = async (state) => (await createDemoClient(state).from("unit_occupancy")).data
const heldOf = async (state) => (await occupancyOf(state)).filter((o) => o.kind === "reservation").map((o) => o.id)

test("editar una reserva de ejemplo cambia unidad, fechas y total, y la ocupación la sigue", async () => {
  const res = applyDemoUpdate(EMPTY_DEMO_STATE, "res-3", edit({ unitId: "unit-1", guests: 4, checkIn: "2026-09-20", checkOut: "2026-09-22" }))
  assert.equal(res.ok, true)
  assert.equal(res.summary.changed, true)
  assert.equal(res.summary.unitName, "Cabaña del Bosque")
  // Tarifa base de la unidad por noche; seña según la propiedad.
  assert.deepEqual(demoStayPrice(EMPTY_DEMO_STATE, "unit-1", 2), { total: 296000, deposit: 148000 })
  assert.equal(res.summary.total, 296000)

  const moved = (await reservationsOf(res.state)).find((r) => r.id === "res-3")
  assert.deepEqual([moved.unit_id, moved.check_in, moved.units.name], ["unit-1", "2026-09-20", "Cabaña del Bosque"])
  const occ = (await occupancyOf(res.state)).find((o) => o.id === "occ-res-3")
  assert.deepEqual([occ.unit_id, occ.during], ["unit-1", "[2026-09-20,2026-09-22)"])
  // Lo base no se toca.
  assert.equal((await reservationsOf(EMPTY_DEMO_STATE)).find((r) => r.id === "res-3").unit_id, "unit-3")
})

test("los pagos no se tocan y el saldo puede quedar negativo", () => {
  // res-1 tiene 296.000 cobrados; una sola noche en la Suite (112.000) lo deja cobrado de más.
  const res = applyDemoUpdate(EMPTY_DEMO_STATE, "res-1", edit({ unitId: "unit-2", guests: 2, checkIn: "2026-09-26", checkOut: "2026-09-27", fullName: "Martina Roldán" }))
  assert.equal(res.ok, true)
  assert.deepEqual([res.summary.paid, res.summary.total, res.summary.balance], [296000, 112000, -184000])
})

test("las mismas validaciones que la base", () => {
  const cases = [
    [{ unitId: "unit-9" }, /unidad/],
    [{ fullName: " " }, /nombre/],
    [{ guests: 0 }, /al menos 1/],
    [{ checkOut: "2026-09-14" }, /no son válidas/],
    [{ unitId: "unit-2", guests: 3 }, /supera la capacidad/],
    [{ unitId: "unit-2", guests: 2, checkIn: "2026-09-11", checkOut: "2026-09-12" }, /ya están ocupadas/], // pisa a res-2
  ]
  for (const [patch, expected] of cases) {
    const res = applyDemoUpdate(EMPTY_DEMO_STATE, "res-3", edit(patch))
    assert.equal(res.ok, false, JSON.stringify(patch))
    assert.match(res.error, expected, JSON.stringify(patch))
  }
  assert.equal(applyDemoUpdate(EMPTY_DEMO_STATE, "no-existe", edit()).ok, false)
  // Una cancelada no se edita.
  const cancelled = applyDemoTransition(EMPTY_DEMO_STATE, "res-3", "cancelled")
  assert.match(applyDemoUpdate(cancelled, "res-3", edit()).error, /cancelada o expirada/)
  // Sin cambios, lo dice.
  assert.equal(applyDemoUpdate(EMPTY_DEMO_STATE, "res-3", edit()).summary.changed, false)
})

test("una reserva cargada por el visitante se edita en su lugar", async () => {
  let state = applyDemoManualReservation(EMPTY_DEMO_STATE, manual({ checkIn: "2026-10-01", checkOut: "2026-10-04" })).state
  const other = applyDemoManualReservation(state, manual({ checkIn: "2026-10-10", checkOut: "2026-10-12", fullName: "Otra" }))
  state = other.state
  // Mover la segunda sobre la primera se rechaza; a una fecha libre, no.
  const clash = applyDemoUpdate(state, other.id, edit({ unitId: "unit-1", guests: 2, fullName: "Otra", checkIn: "2026-10-02", checkOut: "2026-10-05" }))
  assert.match(clash.error, /ya están ocupadas/)
  const ok = applyDemoUpdate(state, other.id, edit({ unitId: "unit-1", guests: 2, fullName: "Otra Persona", checkIn: "2026-10-20", checkOut: "2026-10-22" }))
  assert.equal(ok.ok, true)
  assert.equal(ok.state.created.length, 2, "no se duplicó")
  const row = (await reservationsOf(ok.state)).find((r) => r.id === other.id)
  assert.deepEqual([row.guests.full_name, row.check_in, row.total_amount], ["Otra Persona", "2026-10-20", 296000])
})

test("cancelar, eliminar o mover una reserva se ve en el calendario", async () => {
  assert.deepEqual((await heldOf(EMPTY_DEMO_STATE)).sort(), ["occ-res-1", "occ-res-2", "occ-res-3"])

  // Cancelar libera; una Completada sigue ocupando y reabrirla la deja ocupando.
  const cancelled = applyDemoTransition(EMPTY_DEMO_STATE, "res-3", "cancelled")
  assert.ok(!(await heldOf(cancelled)).includes("occ-res-3"))
  const completed = applyDemoTransition(EMPTY_DEMO_STATE, "res-3", "completed")
  assert.ok((await heldOf(completed)).includes("occ-res-3"), "Completada sigue ocupando")
  assert.ok((await heldOf(applyDemoTransition(completed, "res-3", "confirmed"))).includes("occ-res-3"))

  // Eliminar libera y desaparece del listado; con pagos acreditados se rechaza.
  const deleted = applyDemoDelete(EMPTY_DEMO_STATE, "res-3")
  assert.equal(deleted.ok, true)
  assert.ok(!(await heldOf(deleted.state)).includes("occ-res-3"))
  assert.ok(!(await reservationsOf(deleted.state)).some((r) => r.id === "res-3"))
  assert.equal((await reservationsOf(EMPTY_DEMO_STATE)).some((r) => r.id === "res-3"), true, "las fixtures base no se mutaron")
  assert.match(applyDemoDelete(EMPTY_DEMO_STATE, "res-1").error, /pagos registrados/)
  assert.match(applyDemoDelete(deleted.state, "res-3").error, /ya la hayan eliminado/)

  // Una reserva cargada por el visitante se borra de su lista.
  const mine = applyDemoManualReservation(EMPTY_DEMO_STATE, manual())
  const gone = applyDemoDelete(mine.state, mine.id)
  assert.equal(gone.ok, true)
  assert.equal(gone.state.created.length, 0)
})

test("el bloqueo importado de Booking sigue en el calendario pase lo que pase con las reservas", async () => {
  const state = applyDemoDelete(EMPTY_DEMO_STATE, "res-3").state
  const blocks = (await occupancyOf(state)).filter((o) => o.kind === "block")
  assert.deepEqual(blocks.map((b) => b.external_source), ["booking"])
})

test("el estado viejo de una cookie sigue sirviendo y la cookie no crece sin control", () => {
  // Cookie de antes de editar/eliminar: no tiene esos campos.
  const old = btoa(JSON.stringify({ created: [], statuses: { "res-1": "cancelled" }, units: {}, property: {}, movements: {} }))
  const parsed = parseDemoState(old)
  assert.deepEqual([parsed.edits, parsed.deleted, parsed.statuses["res-1"]], [{}, [], "cancelled"])
  assert.deepEqual(parseDemoState(btoa(JSON.stringify({ edits: [1, 2], deleted: "x" }))).edits, {})
  assert.deepEqual(parseDemoState(btoa(JSON.stringify({ deleted: [1, "a", null, "b"] }))).deleted, ["a", "b"])

  // Aunque el visitante cargue y borre sin parar, lo que se lee de vuelta está acotado.
  let state = EMPTY_DEMO_STATE
  for (let i = 0; i < 30; i++) {
    const r = applyDemoManualReservation(state, manual({ fullName: `Persona ${i}` }))
    state = applyDemoDelete(r.state, r.id).state
    state = { ...state, deleted: [...state.deleted, `demo-borrada-${i}`] }
  }
  const back = parseDemoState(serializeDemoState(state))
  assert.ok(back.deleted.length <= 12)
  assert.ok(serializeDemoState(back).length < 2500)
})
