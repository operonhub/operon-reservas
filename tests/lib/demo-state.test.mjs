/**
 * M-05: la demo es por visitante. El estado vive en la cookie de cada uno,
 * las fixtures base son inmutables y hay un techo de altas.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  EMPTY_DEMO_STATE,
  applyDemoManualReservation,
  applyDemoTransition,
  applyDemoUnitPatch,
  parseDemoState,
  serializeDemoState,
  createDemoClient,
} from "../../src/lib/demo/fixtures.ts"

const manual = (over = {}) => ({
  unitId: "unit-1", fullName: "Nueva Persona", email: null, phone: null,
  checkIn: "2026-10-01", checkOut: "2026-10-04", guests: 2, status: "confirmed", notes: null, ...over,
})
const reservationsOf = async (state) => (await createDemoClient(state).from("reservations")).data
const unitsOf = async (state) => (await createDemoClient(state).from("units")).data

test("una alta va al estado del visitante sin tocar las fixtures base", async () => {
  const baseCount = (await reservationsOf(EMPTY_DEMO_STATE)).length
  const res = applyDemoManualReservation(EMPTY_DEMO_STATE, manual())
  assert.ok(res)
  assert.equal(res.state.created.length, 1)
  // El estado vacío original sigue viendo lo mismo: nada se mutó.
  assert.equal((await reservationsOf(EMPTY_DEMO_STATE)).length, baseCount)
  assert.equal((await reservationsOf(res.state)).length, baseCount + 1)
})

test("dos visitantes no se ven lo que carga el otro", async () => {
  const a = applyDemoManualReservation(EMPTY_DEMO_STATE, manual({ fullName: "Visitante A" })).state
  const b = applyDemoManualReservation(EMPTY_DEMO_STATE, manual({ fullName: "Visitante B" })).state
  const namesA = (await reservationsOf(a)).map((r) => r.guests.full_name)
  const namesB = (await reservationsOf(b)).map((r) => r.guests.full_name)
  assert.ok(namesA.includes("Visitante A") && !namesA.includes("Visitante B"))
  assert.ok(namesB.includes("Visitante B") && !namesB.includes("Visitante A"))
})

test("el techo de altas descarta las más viejas", () => {
  let state = EMPTY_DEMO_STATE
  for (let i = 0; i < 10; i++) {
    state = applyDemoManualReservation(state, manual({ fullName: `Persona ${i}` })).state
  }
  assert.equal(state.created.length, 6)
  assert.equal(state.created[0].guest.full_name, "Persona 9") // la más nueva primero
  assert.ok(!state.created.some((r) => r.guest.full_name === "Persona 0"))
})

test("una unidad inexistente no crea nada", () => {
  assert.equal(applyDemoManualReservation(EMPTY_DEMO_STATE, manual({ unitId: "unit-999" })), null)
})

test("transición: cambia el estado de una reserva base y de una creada", async () => {
  const created = applyDemoManualReservation(EMPTY_DEMO_STATE, manual()).state
  const id = created.created[0].id
  const state = applyDemoTransition(applyDemoTransition(created, "res-3", "cancelled"), id, "pending_payment")
  const byId = Object.fromEntries((await reservationsOf(state)).map((r) => [r.id, r.status]))
  assert.equal(byId["res-3"], "cancelled")
  assert.equal(byId[id], "pending_payment")
  assert.equal(applyDemoTransition(EMPTY_DEMO_STATE, "no-existe", "cancelled"), null)
})

test("parche de unidad: se ve en las lecturas, el id inválido devuelve null", async () => {
  const state = applyDemoUnitPatch(EMPTY_DEMO_STATE, "unit-2", { name: "Suite Renombrada", is_active: false })
  const unit = (await unitsOf(state)).find((u) => u.id === "unit-2")
  assert.equal(unit.name, "Suite Renombrada")
  assert.equal(unit.is_active, false)
  assert.equal(applyDemoUnitPatch(EMPTY_DEMO_STATE, "unit-999", { name: "x" }), null)
})

test("la cookie ida y vuelta conserva el estado; basura vuelve a vacío", () => {
  const state = applyDemoManualReservation(EMPTY_DEMO_STATE, manual()).state
  assert.deepEqual(parseDemoState(serializeDemoState(state)), state)
  assert.deepEqual(parseDemoState("no-es-base64-valido!!!"), EMPTY_DEMO_STATE)
  assert.deepEqual(parseDemoState(undefined), EMPTY_DEMO_STATE)
})
