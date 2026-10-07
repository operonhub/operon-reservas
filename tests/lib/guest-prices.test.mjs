/**
 * Precio según personas (0040): la vista previa de la pantalla tiene que dar lo
 * mismo que cobra la base. Los números son los de tests/db/precio-segun-personas.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applyGuestPrice, tierChangePct, describeTier, draftsFor, looksLikeMissingZeros, parseAmount, parseDrafts, peopleLabel,
} from "../../src/lib/guest-prices.ts"

const pct20 = { guests: 2, mode: "percent", value: 20 }
const fixed90 = { guests: 3, mode: "fixed", value: 90000 }

test("mismo resultado que la base: sobre el precio base y sobre un fin de semana largo", () => {
  // Sin ajuste, el precio queda igual.
  assert.equal(applyGuestPrice(100000, 100000, null), 100000)
  assert.equal(applyGuestPrice(170000, 100000, undefined), 170000)
  // 20% menos sobre lo que cueste la noche.
  assert.equal(applyGuestPrice(100000, 100000, pct20), 80000)
  assert.equal(applyGuestPrice(170000, 100000, pct20), 136000)
  assert.equal(applyGuestPrice(90000, 100000, pct20), 72000)
  // Precio fijo: exacto a tarifa base; la misma proporción con otro precio.
  assert.equal(applyGuestPrice(100000, 100000, fixed90), 90000)
  assert.equal(applyGuestPrice(170000, 100000, fixed90), 153000)
  assert.equal(applyGuestPrice(90000, 100000, fixed90), 81000)
  // Sin base conocida o base en cero: el precio fijo tal cual, nunca una división rara.
  assert.equal(applyGuestPrice(170000, null, fixed90), 90000)
  assert.equal(applyGuestPrice(170000, 0, fixed90), 90000)
  // Redondeo a centavos, como la base.
  assert.equal(applyGuestPrice(99999, 100000, { guests: 2, mode: "percent", value: 33.33 }), 66669.33)
})

test("textos que ve el dueño", () => {
  const money = (n) => "$ " + n.toLocaleString("es-AR")
  assert.equal(describeTier(pct20, money), "20% menos")
  assert.equal(describeTier(fixed90, money), "$ 90.000")
  assert.equal(tierChangePct(pct20, 100000), -20)
  assert.equal(tierChangePct(fixed90, 100000), -10)
  assert.equal(tierChangePct({ guests: 4, mode: "fixed", value: 120000 }, 100000), 20) // recargo
  assert.equal(tierChangePct(fixed90, null), null)
  assert.equal(peopleLabel(1), "1 persona")
  assert.equal(peopleLabel(5), "5 personas")
})

test("el formulario arma una fila por cantidad y guarda solo las que cambian el precio", () => {
  const drafts = draftsFor(4, [pct20, fixed90])
  assert.deepEqual(drafts.map((d) => [d.guests, d.mode, d.value]), [
    [1, "full", ""], [2, "percent", "20"], [3, "fixed", "90000"], [4, "full", ""],
  ])
  assert.deepEqual(parseDrafts(drafts, 4), { tiers: [pct20, fixed90] })
  // Todo en "precio completo": lista vacía, vuelve a cobrar por unidad.
  assert.deepEqual(parseDrafts(draftsFor(4, []), 4), { tiers: [] })
  // Coma decimal, como se escribe acá.
  assert.deepEqual(parseDrafts([{ guests: 2, mode: "percent", value: "12,5" }], 4), { tiers: [{ guests: 2, mode: "percent", value: 12.5 }] })
})

test("no deja guardar valores que la base rechazaría", () => {
  const bad = [
    [{ guests: 2, mode: "percent", value: "" }, /porcentaje para 2 personas/],
    [{ guests: 2, mode: "percent", value: "100" }, /menor a 100/],
    [{ guests: 2, mode: "percent", value: "-5" }, /porcentaje/],
    [{ guests: 3, mode: "fixed", value: "0" }, /precio para 3 personas/],
    [{ guests: 3, mode: "fixed", value: "abc" }, /precio/],
    [{ guests: 3, mode: "fixed", value: "100,555" }, /dos decimales/],
    [{ guests: 9, mode: "fixed", value: "100" }, /inválida/], // no entra en la unidad
  ]
  for (const [draft, error] of bad) {
    const result = parseDrafts([draft], 4)
    assert.match(result.error ?? "", error, JSON.stringify(draft))
  }
})

test("el precio fijo se lee como se escribe acá: 50000, 50.000 y $ 50.000 son lo mismo", () => {
  for (const raw of ["50000", "50.000", "$ 50.000", " 50.000 ", "$50000"]) assert.equal(parseAmount(raw, "fixed"), 50000, raw)
  assert.equal(parseAmount("1.250.000", "fixed"), 1250000)
  assert.equal(parseAmount("50.000,50", "fixed"), 50000.5)
  assert.equal(parseAmount("112500,5", "fixed"), 112500.5)
  assert.equal(parseAmount("50,5", "fixed"), 50.5)
  assert.equal(parseAmount("1.5", "fixed"), 1.5) // un solo dígito después del punto: decimal, no miles
  for (const raw of ["", "abc", "-5", "5-0", "1.2.3", "50.000.", "1e3"]) assert.ok(Number.isNaN(parseAmount(raw, "fixed")), raw)
})

test("en un porcentaje el punto es decimal", () => {
  assert.equal(parseAmount("12.5", "percent"), 12.5)
  assert.equal(parseAmount("12,5", "percent"), 12.5)
  assert.equal(parseAmount("25", "percent"), 25)
  assert.ok(Number.isNaN(parseAmount("veinte", "percent")))
})

test("lo que escribe la clienta llega bien al guardar", () => {
  // El caso real: AGUA, 1 persona, precio fijo, "50.000".
  assert.deepEqual(parseDrafts([{ guests: 1, mode: "fixed", value: "50.000" }], 4), { tiers: [{ guests: 1, mode: "fixed", value: 50000 }] })
  assert.deepEqual(parseDrafts([{ guests: 1, mode: "fixed", value: "$ 50000" }], 4), { tiers: [{ guests: 1, mode: "fixed", value: 50000 }] })
  // Lo guardado se vuelve a leer igual al reabrir el diálogo.
  const again = draftsFor(4, [{ guests: 1, mode: "fixed", value: 50000 }, { guests: 2, mode: "percent", value: 12.5 }, { guests: 3, mode: "fixed", value: 99999.5 }])
  assert.deepEqual(parseDrafts(again, 4), { tiers: [
    { guests: 1, mode: "fixed", value: 50000 }, { guests: 2, mode: "percent", value: 12.5 }, { guests: 3, mode: "fixed", value: 99999.5 }] })
})

test("avisa cuando un precio fijo parece tener un cero de menos", () => {
  const fixed = (value) => ({ guests: 1, mode: "fixed", value })
  assert.equal(looksLikeMissingZeros(fixed(50), 150000), true)
  assert.equal(looksLikeMissingZeros(fixed(5000), 150000), true)
  assert.equal(looksLikeMissingZeros(fixed(50000), 150000), false)
  assert.equal(looksLikeMissingZeros(fixed(50), null), false)
  assert.equal(looksLikeMissingZeros({ guests: 1, mode: "percent", value: 5 }, 150000), false)
})
