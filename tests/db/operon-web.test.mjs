/**
 * La web de cada cliente (migración 0038): cargarla, verificarla y verla en la
 * ficha y en el listado, solo para platform admins y con registro.
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
  await as(db, "postgres")
  const admin = (await one(db, "insert into auth.users (email) values ('santiago@operonhub.test') returning id")).id
  await db.query("insert into platform_admins (user_id) values ($1)", [admin])
  return { db, ids, admin }
}
const state = async (db, org) => {
  await as(db, "postgres")
  return one(db, "select website_url, website_status, website_note, website_checked_at from organizations where id = $1", [org])
}
const entries = async (db) => {
  await as(db, "postgres")
  return rows(db, "select action, detail from app_private.admin_audit_log where action like 'website.%' order by id")
}

test("solo un platform admin carga, verifica y lista las webs", async () => {
  const { db, ids } = await fresh()
  const calls = [
    ["select operon_set_website($1, 'https://x.com')", [ids.org_a]],
    ["select operon_record_website_check($1, 'connected', null)", [ids.org_a]],
    ["select * from operon_websites()", []],
  ]
  for (const [role, uid] of [["anon", ""], ["authenticated", ids.owner_a], ["authenticated", ids.staff_a]]) {
    await as(db, role, { uid })
    for (const [sql, params] of calls) assert.ok((await attempt(db, sql, params)).error, `${role} ${uid}: ${sql}`)
    // Tampoco se escribe directo: el dueño no puede marcar su web como conectada.
    await as(db, role, { uid })
    const direct = await attempt(db, "update organizations set website_status = 'connected' where id = $1 returning id", [ids.org_a])
    assert.ok(direct.error || direct.rows.length === 0, `${role} ${uid}: update directo`)
  }
  assert.deepEqual(await state(db, ids.org_a), { website_url: null, website_status: null, website_note: null, website_checked_at: null })
  await db.close()
})

test("cargar la web: valida la dirección, limpia el estado anterior y deja registro", async () => {
  const { db, ids, admin } = await fresh()
  await as(db, "authenticated", { uid: admin })
  for (const bad of ["javascript:alert(1)", "ftp://x.com", "https://x.com/a b", "x.com"]) {
    assert.match((await attempt(db, "select operon_set_website($1, $2)", [ids.org_a, bad])).error, /INVALID_URL/, bad)
  }
  assert.match((await attempt(db, "select operon_set_website($1, $2)", [ids.org_a, "https://x.com/" + "a".repeat(300)])).error, /INVALID_URL/)
  assert.match((await attempt(db, "select operon_set_website(gen_random_uuid(), 'https://x.com')")).error, /ORG_NOT_FOUND/)

  await db.query("select operon_set_website($1, '  https://sucomplejo.com.ar/reservas  ')", [ids.org_a])
  await db.query("select operon_record_website_check($1, 'mismatch', 'Apunta a otro')", [ids.org_a])
  assert.equal((await state(db, ids.org_a)).website_status, "mismatch")

  // Cambiar la dirección: el estado viejo ya no vale.
  await as(db, "authenticated", { uid: admin })
  await db.query("select operon_set_website($1, 'https://nueva.com.ar')", [ids.org_a])
  assert.deepEqual(await state(db, ids.org_a), { website_url: "https://nueva.com.ar", website_status: null, website_note: null, website_checked_at: null })
  // Guardar lo mismo no ensucia el registro; vaciar sí es un cambio.
  await as(db, "authenticated", { uid: admin })
  await db.query("select operon_set_website($1, 'https://nueva.com.ar')", [ids.org_a])
  await db.query("select operon_set_website($1, '')", [ids.org_a])
  assert.equal((await state(db, ids.org_a)).website_url, null)

  assert.deepEqual((await entries(db)).map(e => [e.action, e.detail.url ?? null, e.detail.previous ?? null]), [
    ["website.set", "https://sucomplejo.com.ar/reservas", null],
    ["website.check", null, null],
    ["website.set", "https://nueva.com.ar", "https://sucomplejo.com.ar/reservas"],
    ["website.set", null, "https://nueva.com.ar"],
  ])
  await db.close()
})

test("verificar: exige web cargada y un estado válido, y solo registra cuando cambia", async () => {
  const { db, ids, admin } = await fresh()
  await as(db, "authenticated", { uid: admin })
  assert.match((await attempt(db, "select operon_record_website_check($1, 'connected', null)", [ids.org_a])).error, /NO_WEBSITE/)
  await db.query("select operon_set_website($1, 'https://sucomplejo.com.ar')", [ids.org_a])
  assert.match((await attempt(db, "select operon_record_website_check($1, 'perfecta', null)", [ids.org_a])).error, /INVALID_STATUS/)

  await db.query("select operon_record_website_check($1, 'not_found', null)", [ids.org_a])
  await db.query("select operon_record_website_check($1, 'not_found', null)", [ids.org_a]) // igual: sin registro nuevo
  await db.query("select operon_record_website_check($1, 'connected', $2)", [ids.org_a, "n".repeat(500)])
  const s = await state(db, ids.org_a)
  assert.equal(s.website_status, "connected")
  assert.equal(s.website_note.length, 300)
  assert.ok(s.website_checked_at)
  assert.deepEqual((await entries(db)).filter(e => e.action === "website.check").map(e => [e.detail.status, e.detail.previous]),
    [["not_found", null], ["connected", "not_found"]])
  await db.close()
})

test("la ficha y el listado muestran la web de cada cliente", async () => {
  const { db, ids, admin } = await fresh()
  await as(db, "authenticated", { uid: admin })
  await db.query("select operon_set_website($1, 'https://a.com.ar')", [ids.org_a])
  await db.query("select operon_record_website_check($1, 'mismatch', 'Apunta a otro')", [ids.org_a])
  await db.query("select operon_set_website($1, 'https://b.com.ar')", [ids.org_b])

  const detail = (await one(db, "select operon_client_detail($1) d", [ids.org_a])).d.org
  assert.deepEqual([detail.website_url, detail.website_status, detail.website_note], ["https://a.com.ar", "mismatch", "Apunta a otro"])
  assert.ok(detail.website_checked_at)
  assert.equal(detail.slug.length > 0, true)

  const list = await rows(db, "select * from operon_websites() order by website_url")
  assert.deepEqual(list.map(r => [r.organization_id, r.website_url, r.website_status]), [
    [ids.org_a, "https://a.com.ar", "mismatch"],
    [ids.org_b, "https://b.com.ar", null],
  ])
  // Un cliente sin web no aparece.
  await db.query("select operon_set_website($1, null)", [ids.org_b])
  assert.equal((await rows(db, "select * from operon_websites()")).length, 1)
  await db.close()
})
