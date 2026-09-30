import { test } from "node:test"
import assert from "node:assert/strict"
import { activity, daysSince } from "../../src/lib/operon/format.ts"

const NOW = Date.parse("2026-09-29T12:00:00Z")
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString()

test("actividad: cuenta lo más reciente entre ingreso y última reserva", () => {
  // Nunca entró, pero cargó una reserva hace 3 días: está activo.
  assert.equal(activity({ last_sign_in_at: null, last_reservation_at: ago(3) }, NOW).label, "Activo")
  // Entró hace 20 días y la última reserva es de hace 90: poco activo.
  assert.equal(activity({ last_sign_in_at: ago(20), last_reservation_at: ago(90) }, NOW).label, "Poco activo")
  assert.equal(activity({ last_sign_in_at: ago(45), last_reservation_at: null }, NOW).label, "Inactivo")
  assert.equal(activity({ last_sign_in_at: null, last_reservation_at: null }, NOW).label, "Sin actividad")
})

test("actividad: los bordes de 7 y 30 días", () => {
  assert.equal(activity({ last_sign_in_at: ago(7), last_reservation_at: null }, NOW).label, "Activo")
  assert.equal(activity({ last_sign_in_at: ago(8), last_reservation_at: null }, NOW).label, "Poco activo")
  assert.equal(activity({ last_sign_in_at: ago(30), last_reservation_at: null }, NOW).label, "Poco activo")
  assert.equal(activity({ last_sign_in_at: ago(31), last_reservation_at: null }, NOW).label, "Inactivo")
  assert.equal(daysSince(null, NOW), Infinity)
})
