/**
 * Cómo se nombran en el calendario los bloqueos importados de Booking/Airbnb.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { asCalendarSource, blockLabel, CALENDAR_SOURCE_NAMES } from "../../src/lib/calendar-sources.ts"

test("solo Booking y Airbnb cuentan como plataforma", () => {
  assert.equal(asCalendarSource("booking"), "booking")
  assert.equal(asCalendarSource("airbnb"), "airbnb")
  for (const other of [null, undefined, "", "vrbo", "Booking", 3]) assert.equal(asCalendarSource(other), null, String(other))
  assert.deepEqual(CALENDAR_SOURCE_NAMES, { airbnb: "Airbnb", booking: "Booking" })
})

test("un bloqueo importado se llama 'Reserva en …' y uno manual conserva su motivo", () => {
  assert.equal(blockLabel(null, "booking"), "Reserva en Booking")
  assert.equal(blockLabel("", "airbnb"), "Reserva en Airbnb")
  assert.equal(blockLabel("   ", "booking"), "Reserva en Booking")
  assert.equal(blockLabel(null, null), "Bloqueo")
  assert.equal(blockLabel(undefined, null), "Bloqueo")
  // El motivo que escribió una persona manda aunque venga de una plataforma.
  assert.equal(blockLabel("Mantenimiento", null), "Mantenimiento")
  assert.equal(blockLabel("A confirmar", "booking"), "A confirmar")
})
