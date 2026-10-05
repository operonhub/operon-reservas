/**
 * Precio según personas (0040): la vista previa de la pantalla tiene que dar lo
 * mismo que cobra la base. Los números son los de tests/db/precio-segun-personas.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyGuestPrice, tierChangePct, describeTier, draftsFor, parseDrafts, peopleLabel } from "../../src/lib/guest-prices.ts"

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
    [{ guests: 3, mode: "fixed", value: "100.555" }, /dos decimales/],
    [{ guests: 9, mode: "fixed", value: "100" }, /inválida/], // no entra en la unidad
  ]
  for (const [draft, error] of bad) {
    const result = parseDrafts([draft], 4)
    assert.match(result.error ?? "", error, JSON.stringify(draft))
  }
})
