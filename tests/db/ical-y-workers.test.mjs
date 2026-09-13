/**
 * Migración 0028: token del link de exportación iCal (B-01) y URL de las
 * Edge Functions fuera de las migraciones (B-07), contra el esquema real en
 * PGlite.
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
const one = async (db, sql, params) => (await rows(db, sql, params))[0]

test("B-01: cada unidad tiene su propio token de exportación", async () => {
  const { db, ids } = await fresh()
  const tokens = await rows(db, "select ical_token from units")
  assert.equal(tokens.length, 2)
  for (const { ical_token } of tokens) assert.match(ical_token, /^[0-9a-f]{36}$/)
  assert.notEqual(tokens[0].ical_token, tokens[1].ical_token)

  const [nueva] = await rows(db,
    "insert into units (organization_id, property_id, name) values ($1, $2, 'Nueva') returning ical_token",
    [ids.org_a, ids.prop_a])
  assert.match(nueva.ical_token, /^[0-9a-f]{36}$/)
  await db.close()
})

test("B-01: el uuid que publica public_availability ya no alcanza para leer el feed", async () => {
  const { db, ids } = await fresh()
  const { ical_token: token } = await one(db, "select ical_token from units where id = $1", [ids.unit_a])

  await as(db, "anon")
  const [avail] = await rows(db,
    "select * from public_availability('alto-cielo', null, '2027-04-01', '2027-04-03', 2)")
  assert.equal(avail.unit_id, ids.unit_a)
  assert.ok(!("ical_token" in avail))

  const sinToken = await one(db, "select public_ical_feed($1, null) f", [ids.unit_a])
  assert.deepEqual(sinToken.f, { found: false })
  const otroToken = await one(db, "select public_ical_feed($1, $2) f", [ids.unit_a, "0".repeat(36)])
  assert.deepEqual(otroToken.f, { found: false })
  // El token de otra unidad tampoco sirve.
  await as(db, "postgres")
  const { ical_token: tokenB } = await one(db, "select ical_token from units where id = $1", [ids.unit_b])
  await as(db, "anon")
  assert.deepEqual((await one(db, "select public_ical_feed($1, $2) f", [ids.unit_a, tokenB])).f, { found: false })

  const ok = await one(db, "select public_ical_feed($1, $2) f", [ids.unit_a, token])
  assert.equal(ok.f.found, true)
  assert.equal(ok.f.unit_name, "Cabaña A")

  // La firma vieja, solo con el uuid, ya no existe.
  assert.ok((await attempt(db, "select public_ical_feed($1::uuid)", [ids.unit_a])).error)
  await db.close()
})

test("B-01: el feed deja afuera lo que terminó hace más de 30 días", async () => {
  const { db, ids } = await fresh()
  const { ical_token: token } = await one(db, "select ical_token from units where id = $1", [ids.unit_a])
  const block = (from, to) =>
    db.query(
      "insert into unit_occupancy (organization_id, unit_id, during, kind) values ($1, $2, daterange($3::date, $4::date, '[)'), 'block')",
      [ids.org_a, ids.unit_a, from, to])
  await block("2020-01-10", "2020-01-15")
  await db.query(
    "insert into unit_occupancy (organization_id, unit_id, during, kind) values ($1, $2, daterange(current_date - 20, current_date - 15, '[)'), 'block')",
    [ids.org_a, ids.unit_a])
  await block("2027-06-01", "2027-06-05")

  await as(db, "anon")
  const { f } = await one(db, "select public_ical_feed($1, $2) f", [ids.unit_a, token])
  const starts = f.ranges.map((r) => r.start_date)
  assert.equal(f.ranges.length, 2)
  assert.ok(!starts.includes("2020-01-10"))
  assert.ok(starts.includes("2027-06-01"))
  await db.close()
})

test("B-07: sin URL cargada, despertar a los workers no llama a nada", async () => {
  const { db } = await fresh()
  assert.equal((await one(db, "select wake_notification_worker() r")).r, null)
  assert.equal((await one(db, "select wake_ical_sync_worker() r")).r, null)

  await db.query("update app_private.edge_functions_config set base_url = 'https://abc123.supabase.co/functions/v1'")
  assert.equal((await one(db, "select app_private.edge_function_url('notify-reservations') u")).u,
    "https://abc123.supabase.co/functions/v1/notify-reservations")
  // El harness reemplaza net.http_post por un id fijo: con URL, sí llama.
  assert.equal(Number((await one(db, "select wake_notification_worker() r")).r), 0)
  assert.equal(Number((await one(db, "select wake_ical_sync_worker() r")).r), 0)

  const mala = await attempt(db, "update app_private.edge_functions_config set base_url = 'http://evil.test/functions/v1'")
  assert.match(mala.error, /check/i)
  await db.close()
})

test("B-07: ni anon ni un miembro leen la config ni despiertan workers", async () => {
  const { db, ids } = await fresh()
  for (const [role, uid] of [["anon", ""], ["authenticated", ids.owner_a]]) {
    await as(db, role, { uid })
    assert.ok((await attempt(db, "select * from app_private.edge_functions_config")).error, role)
    assert.ok((await attempt(db, "select wake_notification_worker()")).error, role)
    assert.ok((await attempt(db, "select wake_ical_sync_worker()")).error, role)
  }
  await db.close()
})
