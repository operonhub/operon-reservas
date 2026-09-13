/**
 * Borrador del asistente de configuración: validación por paso y el payload
 * que recibe complete_setup (migración 0026).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { "@/": root + "src/" }, moduleCache: false })
const d = await jiti.import(root + "src/lib/onboarding/setup-draft.ts")

const valid = () => ({
  ...d.emptyDraft(),
  name: "Cabañas del Lago",
  slug: "cabanas-del-lago",
  units: [
    { name: "Cabaña 1", capacity: "4", price: "85000" },
    { name: "Cabaña 2", capacity: "6", price: "120000,50" },
  ],
})

test("un borrador vacío arranca en el primer paso y uno completo en el resumen", () => {
  assert.equal(d.firstIncompleteStep(d.emptyDraft()), 0)
  assert.equal(d.firstIncompleteStep({ ...d.emptyDraft(), name: "Lago" }), 1)
  assert.equal(d.firstIncompleteStep({ ...valid(), units: [{ name: "A", capacity: "2", price: "" }] }), 4)
  assert.equal(d.firstIncompleteStep(valid()), d.LAST_STEP)
})

test("precios: acepta coma decimal; rechaza puntos de miles, cero y más de dos decimales", () => {
  assert.equal(d.parsePrice("85000"), 85000)
  assert.equal(d.parsePrice(" 120000,50 "), 120000.5)
  assert.equal(d.parsePrice("99.9"), 99.9)
  for (const bad of ["85.000", "0", "-5", "10,555", "", "abc", "1e5"]) assert.equal(d.parsePrice(bad), null, bad)
})

test("el campo de precio muestra puntos de miles y guarda solo el número", () => {
  assert.equal(d.formatPriceInput("150000"), "150.000")
  assert.equal(d.formatPriceInput("1500000,5"), "1.500.000,5")
  assert.equal(d.formatPriceInput(""), "")
  assert.equal(d.cleanPriceInput("150.000"), "150000")
  assert.equal(d.cleanPriceInput("150.000,505"), "150000,50")
  assert.equal(d.cleanPriceInput("$ 85.000 ARS"), "85000")
  assert.equal(d.cleanPriceInput("0085"), "85")
  // Borrar el último dígito de "1.000" tiene que dar 100, no 1,00.
  assert.equal(d.cleanPriceInput("1.00"), "100")
  // Ida y vuelta: lo que se ve, limpio, vuelve a ser un precio válido.
  assert.equal(d.parsePrice(d.cleanPriceInput(d.formatPriceInput("120000,50"))), 120000.5)
})

test("capacidad: entero entre 1 y 50", () => {
  assert.equal(d.parseCapacity("4"), 4)
  for (const bad of ["0", "51", "2.5", "", "muchos"]) assert.equal(d.parseCapacity(bad), null, bad)
})

test("unidades: nombre obligatorio y sin repetir, sin importar mayúsculas ni espacios", () => {
  const units = (list) => ({ ...valid(), units: list })
  assert.match(d.stepError(3, units([{ name: " ", capacity: "2", price: "1" }])), /unidad 1/)
  assert.match(
    d.stepError(3, units([{ name: "Cabaña", capacity: "2", price: "1" }, { name: " cabaña ", capacity: "2", price: "1" }])),
    /dos unidades/
  )
  assert.match(d.stepError(3, units([{ name: "Cabaña", capacity: "0", price: "1" }])), /entre 1 y 50/)
  assert.equal(d.stepError(3, valid()), null)
})

test("normalizeDraft descarta lo que no corresponde y completa lo que falta", () => {
  const draft = d.normalizeDraft({
    name: 123,
    currency: "XXX",
    checkinTime: "99:00",
    slugEdited: "true",
    units: Array.from({ length: 40 }, () => ({ name: "x", capacity: 3 })),
  })
  assert.equal(draft.name, "")
  assert.equal(draft.currency, "ARS")
  assert.equal(draft.checkinTime, "14:00")
  assert.equal(draft.slugEdited, false)
  assert.equal(draft.units.length, d.MAX_UNITS)
  assert.equal(draft.units[0].capacity, "2")
  assert.deepEqual(d.normalizeDraft(null), d.emptyDraft())
  assert.deepEqual(d.normalizeDraft(valid()), valid())
})

test("toSetupPayload arma exactamente lo que espera complete_setup", () => {
  assert.deepEqual(d.toSetupPayload({ ...valid(), city: "  " }), {
    name: "Cabañas del Lago",
    slug: "cabanas-del-lago",
    city: null,
    currency: "ARS",
    timezone: "America/Argentina/Cordoba",
    checkin_time: "14:00",
    checkout_time: "10:00",
    units: [
      { name: "Cabaña 1", capacity: 4, price: 85000 },
      { name: "Cabaña 2", capacity: 6, price: 120000.5 },
    ],
  })
})
