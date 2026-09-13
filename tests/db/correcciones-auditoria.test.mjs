/**
 * Regresión de las correcciones de la auditoría (migración 0024), contra el
 * esquema real en PGlite. Cada test arranca con una base limpia.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDb, as, attempt } from "./harness.mjs"
import { seed } from "./seed.mjs"

async function fresh() {
  const db = await createDb()
  return { db, ids: await seed(db) }
}
const rows = async (db, sql, params) => (await db.query(sql, params)).rows
const count = async (db, sql, params) => (await rows(db, sql, params))[0].n

test("A-01: un feed de iCal vacío no borra los bloqueos importados", async () => {
  const { db, ids } = await fresh()
  const events = [
    { uid: "air-1", start_date: "2027-01-05", end_date: "2027-01-12" },
    { uid: "air-2", start_date: "2027-02-01", end_date: "2027-02-05" },
  ]
  const imported = "select count(*)::int n from unit_occupancy where unit_id = $1 and external_source = 'airbnb'"
  await db.query("select sync_unit_external_blocks($1, $2, 'airbnb', $3::jsonb)", [ids.ical_token, ids.unit_a, JSON.stringify(events)])

  // Worker viejo (4 argumentos) ante un 200 con HTML: parser vacío.
  await db.query("select sync_unit_external_blocks($1, $2, 'airbnb', '[]'::jsonb)", [ids.ical_token, ids.unit_a])
  assert.equal(await count(db, imported, [ids.unit_a]), 2)
  const resale = await attempt(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-01-06', '2027-01-09', 2, 'X', 'x@e.test', null, null)", [ids.unit_a])
  assert.match(resale.error, /UNAVAILABLE/)

  // Calendario válido y sin eventos: el worker nuevo confirma y se libera.
  await db.query("select sync_unit_external_blocks($1, $2, 'airbnb', '[]'::jsonb, true)", [ids.ical_token, ids.unit_a])
  assert.equal(await count(db, imported, [ids.unit_a]), 0)
  await db.close()
})

test("M-03: la reserva pública devuelve total, seña, moneda y vencimiento", async () => {
  const { db, ids } = await fresh()
  const [{ r }] = await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-01', '2027-03-04', 2, 'Ana', 'ana@e.test', null, null) r", [ids.unit_a])
  assert.equal(Number(r.total_amount), 300000)
  assert.equal(Number(r.deposit_amount), 150000)
  assert.equal(r.currency, "ARS")
  assert.ok(r.hold_expires_at)
  await db.close()
})

test("M-01: la ocupación de una reserva no se toca por PostgREST; los bloqueos sí se borran", async () => {
  const { db, ids } = await fresh()
  await as(db, "authenticated", { uid: ids.owner_a })
  const [res] = await rows(db,
    "select id from create_manual_reservation($1, $2, $3, 'Gómez', 'g@e.test', null, '2027-07-10', '2027-07-17', 4, 'confirmed', null)",
    [ids.org_a, ids.prop_a, ids.unit_a])
  const del = await attempt(db, "delete from unit_occupancy where reservation_id = $1 returning id", [res.id])
  assert.deepEqual(del.rows, [])
  const ins = await attempt(db,
    "insert into unit_occupancy (organization_id, unit_id, during, kind) values ($1, $2, '[2027-10-01,2027-10-03)', 'block')",
    [ids.org_a, ids.unit_a])
  assert.ok(ins.error)
  await db.query("select create_block($1, $2, '2027-11-01', '2027-11-05', 'Mantenimiento')", [ids.org_a, ids.unit_a])
  const block = await rows(db, "delete from unit_occupancy where block_reason = 'Mantenimiento' and kind = 'block' returning id")
  assert.equal(block.length, 1)
  await db.close()
})

test("M-02: ningún miembro puede borrar la organización, pero la sigue leyendo", async () => {
  const { db, ids } = await fresh()
  for (const user of [ids.owner_a, ids.staff_a]) {
    await as(db, "authenticated", { uid: user })
    assert.deepEqual((await attempt(db, "delete from organizations where id = $1 returning id", [ids.org_a])).rows, [])
    assert.equal((await rows(db, "select name from organizations where id = $1", [ids.org_a])).length, 1)
  }
  await db.close()
})

test("M-06: no puede haber dos señas pendientes para la misma reserva", async () => {
  const { db, ids } = await fresh()
  const [{ r }] = await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-01', '2027-03-04', 2, 'Ana', 'ana@e.test', null, null) r", [ids.unit_a])
  const [{ id }] = await rows(db, "select id from reservations where code = $1", [r.code])
  const deposit = "insert into payments (organization_id, reservation_id, kind, amount, status) values ($1, $2, 'deposit', 150000, 'pending')"
  await db.query(deposit, [ids.org_a, id])
  assert.match((await attempt(db, deposit, [ids.org_a, id])).error, /unique|duplicate/i)
  await db.close()
})

test("A-02: un pago tardío recupera la reserva expirada si la fecha sigue libre", async () => {
  const { db, ids } = await fresh()
  const book = (from, to, name) => rows(db,
    "select create_public_reservation('alto-cielo', null, $1, $2, $3, 2, $4, 'x@e.test', null, null) r", [ids.unit_a, from, to, name])
  const expire = async (code) => {
    await db.query("update reservations set hold_expires_at = now() - interval '1 minute' where code = $1", [code])
    await db.query("select expire_stale_holds()")
    return (await rows(db, "select id from reservations where code = $1", [code]))[0].id
  }

  const late = await expire((await book("2027-08-01", "2027-08-05", "Efectivo"))[0].r.code)
  assert.equal((await rows(db, "select recover_paid_expired_reservation($1) r", [late]))[0].r, "RECOVERED")
  assert.equal((await rows(db, "select status from reservations where id = $1", [late]))[0].status, "confirmed")
  assert.equal(await count(db,
    "select count(*)::int n from notification_outbox where reservation_id = $1 and event_type = 'reservation_confirmed_admin'", [late]), 1)

  const resold = await expire((await book("2027-09-13", "2027-09-15", "Tarde"))[0].r.code)
  await book("2027-09-13", "2027-09-15", "Revendida")
  assert.equal((await rows(db, "select recover_paid_expired_reservation($1) r", [resold]))[0].r, "UNAVAILABLE")
  assert.equal((await rows(db, "select status from reservations where id = $1", [resold]))[0].status, "expired")

  await as(db, "authenticated", { uid: ids.owner_a })
  assert.ok((await attempt(db, "select transition_reservation($1, 'confirmed')", [resold])).error, "desde el panel expired sigue siendo terminal")
  assert.ok((await attempt(db, "select recover_paid_expired_reservation($1)", [resold])).error, "la RPC es solo del webhook")
  await db.close()
})

test("B-02: el mínimo de noches de una regla de fin de semana no aplica un lunes", async () => {
  const { db, ids } = await fresh()
  await db.query(
    `insert into rates (organization_id, property_id, unit_id, kind, label, price_per_night, weekdays, min_nights, is_active)
     values ($1, $2, $3, 'seasonal', 'Finde', 180000, array[5,6]::smallint[], 2, true)`, [ids.org_a, ids.prop_a, ids.unit_a])
  const min = (from, to) => rows(db, "select _min_nights_required($1, $2, $3, 2) n", [ids.unit_a, from, to]).then((r) => r[0].n)
  assert.equal(await min("2027-09-06", "2027-09-07"), 1)
  assert.equal(await min("2027-09-10", "2027-09-11"), 2)
  assert.equal(await count(db, "select count(*)::int n from public_availability('alto-cielo', null, '2027-09-06', '2027-09-07', 2)"), 1)
  await db.close()
})
