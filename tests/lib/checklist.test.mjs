/** Lista "Primeros pasos": cada ítem sale de datos reales del complejo. */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const jiti = createJiti(import.meta.url, { moduleCache: false })
const { deriveChecklist } = await jiti.import(root + "src/lib/onboarding/checklist.ts")

const recienCreado = {
  units: 2,
  unitsWithBaseRate: 2,
  depositPct: 0,
  mpConnected: false,
  linkShared: false,
  reservations: 0,
}
const done = (list) => Object.fromEntries(list.items.map((i) => [i.key, i.done]))

test("recién salido del asistente: unidades y precio hechos, el resto pendiente", () => {
  const list = deriveChecklist(recienCreado)
  assert.deepEqual(done(list), {
    unidades: true, precio: true, sena: false, mercadopago: false, link: false, reserva: false,
  })
  assert.equal(list.done, 2)
  assert.equal(list.total, 6)
  assert.equal(list.allDone, false)
})

test("una unidad nueva sin tarifa base destilda el precio", () => {
  assert.equal(done(deriveChecklist({ ...recienCreado, units: 3 })).precio, false)
})

test("sin unidades no hay precio que valga", () => {
  assert.equal(done(deriveChecklist({ ...recienCreado, units: 0, unitsWithBaseRate: 0 })).precio, false)
})

test("con todo configurado la lista queda completa", () => {
  const list = deriveChecklist({ ...recienCreado, depositPct: 30, mpConnected: true, linkShared: true, reservations: 1 })
  assert.equal(list.allDone, true)
  assert.equal(list.done, list.total)
})
