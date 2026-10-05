/**
 * Precio según la cantidad de personas (migración 0040), contra el esquema
 * real en PGlite. Unidad de prueba: capacidad 4, base $100.000 por noche.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDb, as, attempt } from "./harness.mjs"
import { seed } from "./seed.mjs"

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0]

async function fresh() {
  const db = await createDb()
  const ids = await seed(db)
  return { db, ids }
}
const setTiers = async (db, uid, unit, tiers) => {
  await as(db, "authenticated", { uid })
  return attempt(db, "select set_unit_guest_prices($1, $2::jsonb) n", [unit, JSON.stringify(tiers)])
}
/** Precio noche por noche que ve el dueño en el simulador. */
const simulate = async (db, ids, from, to, guests) => {
  await as(db, "authenticated", { uid: ids.owner_a })
  return (await one(db, "select simulate_price($1, $2, $3, $4) s", [ids.unit_a, from, to, guests])).s
}
const nightly = (s) => s.breakdown.map((n) => Number(n.price))
const rule = async (db, ids, fields) => {
  await as(db, "postgres")
  const cols = Object.keys(fields)
  await db.query(
    `insert into rates (organization_id, property_id, unit_id, is_active, ${cols.join(", ")})
     values ($1, $2, $3, true, ${cols.map((_, i) => "$" + (i + 4)).join(", ")})`,
    [ids.org_a, ids.prop_a, ids.unit_a, ...Object.values(fields)])
}

test("sin ajustes cargados, el precio no cambia con la cantidad de personas (como antes)", async () => {
  const { db, ids } = await fresh()
  for (const guests of [1, 2, 4]) {
    const s = await simulate(db, ids, "2027-03-01", "2027-03-03", guests)
    assert.deepEqual(nightly(s), [100000, 100000], `${guests} personas`)
    assert.equal(Number(s.total), 200000)
    assert.equal(s.guest_price, null)
  }
  await db.close()
})

test("porcentaje y precio fijo sobre el precio base", async () => {
  const { db, ids } = await fresh()
  assert.equal((await setTiers(db, ids.owner_a, ids.unit_a, [
    { guests: 2, mode: "percent", value: 20 },
    { guests: 3, mode: "fixed", value: 90000 },
  ])).rows[0].n, 2)

  const two = await simulate(db, ids, "2027-03-01", "2027-03-03", 2)
  assert.deepEqual(nightly(two), [80000, 80000])
  assert.equal(Number(two.total), 160000)
  assert.deepEqual(two.guest_price, { mode: "percent", value: 20 })
  assert.deepEqual(two.breakdown.map((n) => Number(n.price_before_guests)), [100000, 100000])

  const three = await simulate(db, ids, "2027-03-01", "2027-03-03", 3)
  assert.deepEqual(nightly(three), [90000, 90000])
  // Para 4 (la cabaña llena) y para 1 no hay ajuste: precio completo.
  assert.deepEqual(nightly(await simulate(db, ids, "2027-03-01", "2027-03-03", 4)), [100000, 100000])
  assert.deepEqual(nightly(await simulate(db, ids, "2027-03-01", "2027-03-03", 1)), [100000, 100000])
  await db.close()
})

test("se aplica ENCIMA de las reglas de fechas: fin de semana largo, descuento, estadía larga", async () => {
  const { db, ids } = await fresh()
  await setTiers(db, ids.owner_a, ids.unit_a, [
    { guests: 2, mode: "percent", value: 20 },
    { guests: 3, mode: "fixed", value: 90000 },
  ])
  // Fecha especial a $170.000 el 10 y el 11 de abril.
  await rule(db, ids, { kind: "special", label: "Finde largo", price_per_night: 170000, start_date: "2027-04-10", end_date: "2027-04-11", priority: 10 })

  // 9 (base), 10 y 11 (finde largo), 12 (base).
  const full = await simulate(db, ids, "2027-04-09", "2027-04-13", 4)
  assert.deepEqual(nightly(full), [100000, 170000, 170000, 100000])
  // 20% menos sobre lo que cueste cada noche.
  const two = await simulate(db, ids, "2027-04-09", "2027-04-13", 2)
  assert.deepEqual(nightly(two), [80000, 136000, 136000, 80000])
  assert.equal(Number(two.total), 432000)
  assert.equal(two.breakdown[1].rule.label, "Finde largo")
  // Precio fijo $90.000 = 90% de la base: la misma proporción en el finde largo.
  const three = await simulate(db, ids, "2027-04-09", "2027-04-13", 3)
  assert.deepEqual(nightly(three), [90000, 153000, 153000, 90000])

  // Encima de un descuento por fechas (10% en mayo): 100.000 → 90.000 → 72.000 para 2.
  await rule(db, ids, { kind: "special", label: "Promo mayo", discount_pct: 10, start_date: "2027-05-01", end_date: "2027-05-31" })
  assert.deepEqual(nightly(await simulate(db, ids, "2027-05-03", "2027-05-04", 2)), [72000])
  assert.deepEqual(nightly(await simulate(db, ids, "2027-05-03", "2027-05-04", 3)), [81000])
  await db.close()
})

test("la web y la reserva cobran lo mismo que muestra el simulador", async () => {
  const { db, ids } = await fresh()
  await setTiers(db, ids.owner_a, ids.unit_a, [{ guests: 2, mode: "percent", value: 20 }])

  await as(db, "anon")
  const offer = async (guests) =>
    one(db, "select price_per_night, total_price from public_availability('alto-cielo', null, '2027-03-01', '2027-03-04', $1)", [guests])
  assert.deepEqual(await offer(2), { price_per_night: "80000.00", total_price: "240000.00" })
  assert.deepEqual(await offer(4), { price_per_night: "100000.00", total_price: "300000.00" })

  // La reserva guarda el total con el ajuste, y la seña (50%) sale de ese total.
  const res = (await one(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-01', '2027-03-04', 2, 'Ana', 'ana@e.test', null, null) r", [ids.unit_a])).r
  await as(db, "postgres")
  const saved = await one(db, "select total_amount, deposit_amount, guests_count from reservations where code = $1", [res.code])
  assert.deepEqual(saved, { total_amount: "240000.00", deposit_amount: "120000.00", guests_count: 2 })

  // Cambiar el ajuste después no toca una reserva ya hecha.
  await setTiers(db, ids.owner_a, ids.unit_a, [{ guests: 2, mode: "percent", value: 50 }])
  await as(db, "postgres")
  assert.equal((await one(db, "select total_amount from reservations where code = $1", [res.code])).total_amount, "240000.00")
  await db.close()
})

test("el simulador avisa la capacidad: con más personas de las que entran no se ofrece en la web", async () => {
  const { db, ids } = await fresh()
  const s = await simulate(db, ids, "2027-03-01", "2027-03-02", 6)
  assert.equal(s.capacity, 4)
  assert.equal(s.guests, 6)
  await as(db, "anon")
  assert.equal((await db.query("select * from public_availability('alto-cielo', null, '2027-03-01', '2027-03-02', 6)")).rows.length, 0)
  await db.close()
})

test("solo el dueño o un administrador cargan los ajustes, y solo de sus unidades", async () => {
  const { db, ids } = await fresh()
  const tiers = [{ guests: 2, mode: "percent", value: 20 }]
  assert.match((await setTiers(db, ids.staff_a, ids.unit_a, tiers)).error, /FORBIDDEN/)
  assert.match((await setTiers(db, ids.owner_b, ids.unit_a, tiers)).error, /FORBIDDEN/)
  await as(db, "anon")
  assert.ok((await attempt(db, "select set_unit_guest_prices($1, '[]'::jsonb)", [ids.unit_a])).error)
  assert.equal((await setTiers(db, ids.admin_a, ids.unit_a, tiers)).rows[0].n, 1)

  // El equipo los lee; otro complejo no; nadie escribe la tabla directo.
  await as(db, "authenticated", { uid: ids.staff_a })
  assert.equal((await db.query("select * from unit_guest_prices")).rows.length, 1)
  assert.ok((await attempt(db, "insert into unit_guest_prices (unit_id, organization_id, guests, mode, value) values ($1, $2, 3, 'percent', 10)", [ids.unit_a, ids.org_a])).error)
  await as(db, "authenticated", { uid: ids.owner_b })
  assert.equal((await db.query("select * from unit_guest_prices")).rows.length, 0)
  await db.close()
})

test("validaciones: cantidades que entran en la unidad, sin repetir, valores razonables; y se puede vaciar", async () => {
  const { db, ids } = await fresh()
  const bad = [
    [[{ guests: 5, mode: "percent", value: 10 }], /INVALID_GUESTS/],   // la unidad es para 4
    [[{ guests: 0, mode: "percent", value: 10 }], /INVALID_GUESTS/],
    [[{ guests: 2, mode: "percent", value: 10 }, { guests: 2, mode: "fixed", value: 5 }], /INVALID_GUESTS/],
    [[{ guests: 2, mode: "percent", value: 100 }], /INVALID_VALUE/],
    [[{ guests: 2, mode: "percent", value: 0 }], /INVALID_VALUE/],
    [[{ guests: 2, mode: "fixed", value: -1 }], /INVALID_VALUE/],
    [[{ guests: 2, mode: "fixed", value: 10.555 }], /INVALID_VALUE/],
    [[{ guests: 2, mode: "gratis", value: 10 }], /INVALID_MODE/],
    [[{ guests: "dos", mode: "percent", value: 10 }], /INVALID_TIERS/],
    [{ guests: 2 }, /INVALID_TIERS/],
  ]
  await setTiers(db, ids.owner_a, ids.unit_a, [{ guests: 3, mode: "percent", value: 10 }])
  for (const [tiers, error] of bad) {
    assert.match((await setTiers(db, ids.owner_a, ids.unit_a, tiers)).error, error, JSON.stringify(tiers))
  }
  // Un intento inválido no borra lo que había.
  await as(db, "postgres")
  assert.deepEqual((await db.query("select guests, mode from unit_guest_prices")).rows, [{ guests: 3, mode: "percent" }])
  // Vaciar: vuelve a cobrar por unidad.
  assert.equal((await setTiers(db, ids.owner_a, ids.unit_a, [])).rows[0].n, 0)
  assert.deepEqual(nightly(await simulate(db, ids, "2027-03-01", "2027-03-02", 3)), [100000])
  await db.close()
})
