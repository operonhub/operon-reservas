/**
 * public_property (0039): la capacidad máxima que usan el widget y la página
 * pública para armar el selector de huéspedes sale de las unidades activas y
 * cambia sola cuando el dueño las cambia.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDb, as } from "./harness.mjs"
import { seed } from "./seed.mjs"

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0]
const maxGuests = async (db) => {
  await as(db, "anon")
  return (await one(db, "select public_property('alto-cielo', null) p")).p.max_guests
}

test("max_guests es la unidad activa más grande y se actualiza con los cambios del dueño", async () => {
  const db = await createDb()
  const ids = await seed(db)
  await as(db, "postgres")
  await db.query("update units set capacity = 4 where organization_id = $1", [ids.org_a])
  await db.query("update units set capacity = 5 where id = $1", [ids.unit_a])
  assert.equal(await maxGuests(db), 5)

  // Suma una unidad más grande: el tope sube solo.
  await as(db, "postgres")
  const prop = (await one(db, "select property_id from units where id = $1", [ids.unit_a])).property_id
  const big = (await one(db,
    "insert into units (organization_id, property_id, name, capacity, position) values ($1, $2, 'Casa grande', 8, 9) returning id",
    [ids.org_a, prop])).id
  assert.equal(await maxGuests(db), 8)

  // La desactiva: deja de contar.
  await as(db, "postgres")
  await db.query("update units set is_active = false where id = $1", [big])
  assert.equal(await maxGuests(db), 5)

  // Las unidades de otro complejo no influyen.
  await as(db, "postgres")
  await db.query("update units set capacity = 12 where organization_id = $1", [ids.org_b])
  assert.equal(await maxGuests(db), 5)

  // Sin unidades activas: null (el widget deja sus opciones por defecto).
  await as(db, "postgres")
  await db.query("update units set is_active = false where organization_id = $1", [ids.org_a])
  assert.equal(await maxGuests(db), null)

  // El resto de la respuesta sigue igual: nadie que ya la consume se rompe.
  await as(db, "anon")
  const p = (await one(db, "select public_property('alto-cielo', null) p")).p
  for (const key of ["name", "description", "city", "currency", "checkin_time", "checkout_time", "deposit_pct", "whatsapp", "phone"]) {
    assert.ok(key in p, key)
  }
  await db.close()
})
