/**
 * Migración 0047: precio especial en reservas cargadas desde el panel.
 *
 * Lo que tiene que cumplirse siempre:
 *  - el total especial manda sobre el de las tarifas, pero el de lista se conserva;
 *  - la seña se recalcula sobre el total especial;
 *  - $0 solo se guarda con motivo;
 *  - solo dueño o administrador fija, cambia o quita el precio;
 *  - cada cambio queda en el historial como 'priced'.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDb, as, attempt } from "./harness.mjs"
import { seed } from "./seed.mjs"

const rows = async (db, sql, params) => (await db.query(sql, params)).rows
const one = async (db, sql, params) => (await rows(db, sql, params))[0]

async function fresh() {
  const db = await createDb()
  const ids = await seed(db)
  return { db, ids }
}

/** Carga manual como el usuario indicado (owner por defecto). */
async function book(db, ids, { user = "owner_a", from = "2027-03-10", to = "2027-03-13", total = null, note = null } = {}) {
  await as(db, "authenticated", { uid: ids[user] })
  return attempt(db,
    `select * from create_manual_reservation(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [ids.org_a, ids.prop_a, ids.unit_a, "Ana Pérez", "ana@e.test", null, from, to, 2, "confirmed", null, total, note])
}

/** Edita con la firma completa de 0047. */
async function update(db, ids, id, f = {}) {
  await as(db, "authenticated", { uid: ids[f.user ?? "owner_a"] })
  return attempt(db,
    `select update_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) r`,
    [id, f.unit ?? ids.unit_a, f.from ?? "2027-03-10", f.to ?? "2027-03-13", f.guests ?? 2,
     f.name ?? "Ana Pérez", f.email ?? null, f.phone ?? null, f.notes ?? null,
     f.total === undefined ? null : f.total, f.note ?? null, f.clear ?? false])
    .then((x) => (x.error ? x : { row: x.rows[0].r }))
}

const priceOf = async (db, id) => {
  await as(db, "postgres")
  return one(db,
    "select total_amount, deposit_amount, list_amount, price_override, price_override_note from reservations where id = $1", [id])
}

const audit = async (db) => {
  await as(db, "postgres")
  return rows(db, "select action, detail from app_private.reservation_audit where action = 'priced' order by id")
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

test("alta con precio especial: manda el total y se conserva el de lista", async () => {
  const { db, ids } = await fresh()
  const res = await book(db, ids, { total: 210000, note: "Familia" })
  assert.ok(res.rows, res.error)
  const id = res.rows[0].id

  const p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 210000)
  assert.equal(Number(p.list_amount), 300000) // 3 noches × 100.000
  assert.equal(Number(p.deposit_amount), 105000) // 50% sobre el especial
  assert.equal(p.price_override, true)
  assert.equal(p.price_override_note, "Familia")

  // La ocupación se crea igual: el precio no cambia la disponibilidad.
  assert.equal((await one(db, "select count(*)::int n from unit_occupancy where reservation_id = $1", [id])).n, 1)

  const priced = await audit(db)
  assert.equal(priced.length, 1)
  assert.equal(Number(priced[0].detail.from_total), 300000) // lo que calculaba el sistema
  assert.equal(Number(priced[0].detail.to_total), 210000) // lo que se cobra
  assert.equal(Number(priced[0].detail.list_amount), 300000)
  assert.equal(priced[0].detail.created, true)
})

test("alta sin precio especial: todo sale del motor de tarifas", async () => {
  const { db, ids } = await fresh()
  const res = await book(db, ids)
  const id = res.rows[0].id
  const p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 300000)
  assert.equal(Number(p.list_amount), 300000)
  assert.equal(p.price_override, false)
  assert.equal(p.price_override_note, null)
  assert.deepEqual(await audit(db), [])
})

test("estadía sin cargo: exige motivo y deja la seña en 0", async () => {
  const { db, ids } = await fresh()

  const without = await book(db, ids, { total: 0 })
  assert.match(without.error ?? "", /FREE_REASON_REQUIRED/)

  const withNote = await book(db, ids, { total: 0, note: "Canje" })
  assert.ok(withNote.rows, withNote.error)
  const p = await priceOf(db, withNote.rows[0].id)
  assert.equal(Number(p.total_amount), 0)
  assert.equal(Number(p.deposit_amount), 0)
  assert.equal(p.price_override_note, "Canje")
})

test("staff no puede fijar precio especial, pero sí cargar al precio del sistema", async () => {
  const { db, ids } = await fresh()

  const denied = await book(db, ids, { user: "staff_a", total: 250000, note: "Amigo" })
  assert.match(denied.error ?? "", /FORBIDDEN_PRICE/)

  const normal = await book(db, ids, { user: "staff_a" })
  assert.ok(normal.rows, normal.error)
  assert.equal((await priceOf(db, normal.rows[0].id)).price_override, false)
})

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------

test("editar otros datos conserva el precio especial", async () => {
  const { db, ids } = await fresh()
  const id = (await book(db, ids, { total: 210000, note: "Familia" })).rows[0].id

  const res = await update(db, ids, id, { name: "Ana María Pérez" })
  assert.ok(res.row, res.error)
  const p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 210000)
  assert.equal(Number(p.list_amount), 300000)
  assert.equal(p.price_override, true)
  assert.equal(p.price_override_note, "Familia")
})

test("mover las fechas mantiene el total especial y actualiza el precio de lista", async () => {
  const { db, ids } = await fresh()
  const id = (await book(db, ids, { total: 210000, note: "Familia" })).rows[0].id

  const res = await update(db, ids, id, { to: "2027-03-14" }) // 4 noches
  assert.ok(res.row, res.error)
  const p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 210000)
  assert.equal(Number(p.list_amount), 400000)
  assert.equal(Number(p.deposit_amount), 105000)
})

test("cambiar el especial recalcula la seña; quitarlo vuelve al sistema", async () => {
  const { db, ids } = await fresh()
  const id = (await book(db, ids, { total: 210000, note: "Familia" })).rows[0].id

  const changed = await update(db, ids, id, { total: 400000, note: "Amigo" })
  assert.ok(changed.row, changed.error)
  let p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 400000)
  assert.equal(Number(p.deposit_amount), 200000)
  assert.equal(p.price_override_note, "Amigo")

  // Campo vacío en el panel = volver al precio de las tarifas.
  const cleared = await update(db, ids, id, { clear: true })
  assert.ok(cleared.row, cleared.error)
  p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 300000)
  assert.equal(Number(p.list_amount), 300000)
  assert.equal(Number(p.deposit_amount), 150000)
  assert.equal(p.price_override, false)
  assert.equal(p.price_override_note, null)
})

test("editar a $0 sin motivo se rechaza", async () => {
  const { db, ids } = await fresh()
  const id = (await book(db, ids)).rows[0].id

  const res = await update(db, ids, id, { total: 0 })
  assert.match(res.error ?? "", /FREE_REASON_REQUIRED/)
  const p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 300000)
  assert.equal(p.price_override, false)
})

test("staff no puede cambiar ni quitar un precio especial", async () => {
  const { db, ids } = await fresh()
  const id = (await book(db, ids, { total: 210000, note: "Familia" })).rows[0].id

  const change = await update(db, ids, id, { user: "staff_a", total: 100000, note: "Otro" })
  assert.match(change.error ?? "", /FORBIDDEN_PRICE/)

  const clear = await update(db, ids, id, { user: "staff_a", clear: true })
  assert.match(clear.error ?? "", /FORBIDDEN_PRICE/)

  const p = await priceOf(db, id)
  assert.equal(Number(p.total_amount), 210000)
  assert.equal(p.price_override, true)
})

test("cada alta, cambio y baja de precio deja su entrada en el historial", async () => {
  const { db, ids } = await fresh()
  const id = (await book(db, ids, { total: 210000, note: "Familia" })).rows[0].id
  await update(db, ids, id, { total: 250000, note: "Amigo" })
  await update(db, ids, id, { clear: true })

  const priced = await audit(db)
  assert.equal(priced.length, 3)
  assert.equal(priced[0].detail.created, true)
  assert.equal(Number(priced[1].detail.from_total), 210000)
  assert.equal(Number(priced[1].detail.to_total), 250000)
  assert.equal(priced[2].detail.override, false)
  assert.equal(Number(priced[2].detail.to_total), 300000)
})
