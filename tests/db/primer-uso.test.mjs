/**
 * Primer uso (migración 0026): invitaciones, permiso de alta y creación
 * atómica del complejo, contra el esquema real en PGlite.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { createDb, as, attempt } from "./harness.mjs"
import { seed } from "./seed.mjs"

async function fresh() {
  const db = await createDb()
  return { db, ids: await seed(db) }
}
const rows = async (db, sql, params) => (await db.query(sql, params)).rows
const one = async (db, sql, params) => (await rows(db, sql, params))[0]
const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest("hex")

async function newUser(db, email) {
  await as(db, "postgres")
  return (await one(db, "insert into auth.users (email) values ($1) returning id", [email])).id
}

async function platformAdmin(db) {
  const id = await newUser(db, "santiago@operonhub.test")
  await db.query("insert into platform_admins (user_id) values ($1)", [id])
  return id
}

/** Crea una invitación como platform admin; deja la sesión como ese admin. */
async function invite(db, adminId, { email = null } = {}) {
  const hash = tokenHash()
  await as(db, "authenticated", { uid: adminId })
  const { id } = await one(db, "select invitation_create($1, $2, 'Cliente') id", [hash, email])
  return { hash, id }
}

async function redeem(db, hash, userId) {
  await as(db, "service_role")
  return (await one(db, "select invitation_redeem($1, $2) r", [hash, userId])).r
}

const PAYLOAD = {
  name: "Cabañas del Lago",
  slug: "cabanas-del-lago",
  city: "Villa Traful",
  currency: "ARS",
  timezone: "America/Argentina/Cordoba",
  checkin_time: "15:00",
  checkout_time: "10:00",
  units: [
    { name: "Cabaña 1", capacity: 4, price: 85000 },
    { name: "Cabaña 2", capacity: 6, price: 120000.5 },
  ],
}

const complete = (db, payload) =>
  attempt(db, "select complete_setup($1::jsonb) org", [JSON.stringify(payload)])

/** Dueño nuevo con la invitación ya canjeada; deja la sesión como él. */
async function ownerWithGrant(db) {
  const admin = await platformAdmin(db)
  const { hash } = await invite(db, admin)
  const owner = await newUser(db, "duenio@lago.test")
  assert.deepEqual(await redeem(db, hash, owner), { ok: true })
  await as(db, "authenticated", { uid: owner })
  return owner
}

test("solo un platform admin crea, lista y revoca invitaciones", async () => {
  const { db, ids } = await fresh()
  const admin = await platformAdmin(db)

  await as(db, "authenticated", { uid: ids.owner_a })
  assert.match((await attempt(db, "select invitation_create($1, null, null)", [tokenHash()])).error, /FORBIDDEN/)
  assert.match((await attempt(db, "select * from invitation_list()")).error, /FORBIDDEN/)

  const { id } = await invite(db, admin, { email: "  Duenio@Lago.test " })
  const [row] = await rows(db, "select * from invitation_list()")
  assert.equal(row.status, "valid")
  assert.equal(row.email, "duenio@lago.test")

  assert.equal((await one(db, "select invitation_revoke($1) ok", [id])).ok, true)
  assert.equal((await one(db, "select status from invitation_list() where id = $1", [id])).status, "revoked")
  assert.match((await attempt(db, "select invitation_create('no-es-un-hash', null, null)")).error, /INVALID_TOKEN/)
  assert.match((await attempt(db, "select invitation_create($1, 'sin-arroba', null)", [tokenHash()])).error, /INVALID_EMAIL/)
  await db.close()
})

test("anon y los miembros no tocan las tablas privadas ni las RPC de service role", async () => {
  const { db, ids } = await fresh()
  for (const [role, uid] of [["anon", ""], ["authenticated", ids.owner_a]]) {
    await as(db, role, { uid })
    assert.ok((await attempt(db, "select * from app_private.invitations")).error, role)
    assert.ok((await attempt(db, "select * from app_private.setup_grants")).error, role)
    assert.ok((await attempt(db, "select invitation_lookup($1)", [tokenHash()])).error, role)
    assert.ok((await attempt(db, "select invitation_redeem($1, $2)", [tokenHash(), ids.owner_a])).error, role)
  }
  await as(db, "anon")
  assert.ok((await complete(db, PAYLOAD)).error)
  assert.ok((await attempt(db, "select my_onboarding_status()")).error)
  await db.close()
})

test("canje: vigente, reintento, usada, email distinto, vencida, revocada, ya es miembro", async () => {
  const { db, ids } = await fresh()
  const admin = await platformAdmin(db)
  const ana = await newUser(db, "ana@lago.test")
  const beto = await newUser(db, "beto@lago.test")

  const a = await invite(db, admin)
  await as(db, "service_role")
  assert.equal((await one(db, "select invitation_lookup($1) r", [a.hash])).r.status, "valid")
  assert.deepEqual(await redeem(db, a.hash, ana), { ok: true })
  assert.deepEqual(await redeem(db, a.hash, ana), { ok: true })
  assert.deepEqual(await redeem(db, a.hash, beto), { ok: false, reason: "used" })

  const second = await invite(db, admin)
  assert.deepEqual(await redeem(db, second.hash, ana), { ok: false, reason: "already_has_grant" })

  const bound = await invite(db, admin, { email: "carla@lago.test" })
  assert.deepEqual(await redeem(db, bound.hash, beto), { ok: false, reason: "email_mismatch" })

  const expired = await invite(db, admin)
  await as(db, "postgres")
  await db.query("update app_private.invitations set expires_at = now() - interval '1 minute' where id = $1", [expired.id])
  assert.deepEqual(await redeem(db, expired.hash, beto), { ok: false, reason: "expired" })

  const revoked = await invite(db, admin)
  await db.query("select invitation_revoke($1)", [revoked.id])
  assert.deepEqual(await redeem(db, revoked.hash, beto), { ok: false, reason: "revoked" })

  assert.deepEqual(await redeem(db, tokenHash(), beto), { ok: false, reason: "not_found" })

  const member = await invite(db, admin)
  assert.deepEqual(await redeem(db, member.hash, ids.owner_a), { ok: false, reason: "already_member" })
  await db.close()
})

test("complete_setup crea el complejo entero y la web pública ya cotiza", async () => {
  const { db } = await fresh()
  const owner = await ownerWithGrant(db)

  assert.equal((await one(db, "select my_onboarding_status() s")).s.has_grant, true)
  await db.query("select setup_save_draft($1::jsonb)", [JSON.stringify({ step: 4, name: "Cabañas del Lago" })])
  assert.equal((await one(db, "select my_onboarding_status() s")).s.draft.step, 4)
  assert.match(
    (await attempt(db, "select setup_save_draft($1::jsonb)", [JSON.stringify({ x: "a".repeat(17000) })])).error,
    /INVALID_DRAFT/
  )

  const res = await complete(db, PAYLOAD)
  assert.equal(res.error, undefined)
  const org = res.rows[0].org

  // Todo lo que sigue se lee como el dueño: si RLS no lo dejara, fallaría acá.
  assert.equal((await one(db, "select role from memberships where organization_id = $1 and user_id = $2", [org, owner])).role, "owner")
  assert.deepEqual(
    await one(db, "select name, slug, city, currency, timezone, checkin_time::text checkin, is_active from properties where organization_id = $1", [org]),
    { name: "Cabañas del Lago", slug: "cabanas-del-lago", city: "Villa Traful", currency: "ARS", timezone: "America/Argentina/Cordoba", checkin: "15:00:00", is_active: true }
  )
  assert.deepEqual(
    await rows(db,
      `select u.name, u.capacity, u.position, r.price_per_night::text price
         from units u join rates r on r.unit_id = u.id and r.kind = 'base'
        where u.organization_id = $1 order by u.position`, [org]),
    [
      { name: "Cabaña 1", capacity: 4, position: 0, price: "85000.00" },
      { name: "Cabaña 2", capacity: 6, position: 1, price: "120000.50" },
    ]
  )

  assert.equal((await one(db, "select my_onboarding_status() s")).s.has_grant, false)
  assert.match((await complete(db, { ...PAYLOAD, slug: "otro-complejo" })).error, /NO_GRANT/)

  await as(db, "postgres")
  const unit = (await one(db, "select id from units where organization_id = $1 and position = 0", [org])).id
  const { r } = await one(db,
    "select create_public_reservation('cabanas-del-lago', null, $1, '2027-05-10', '2027-05-12', 2, 'Ana', 'ana@e.test', null, null) r", [unit])
  assert.equal(Number(r.total_amount), 170000)
  await db.close()
})

test("si una unidad es inválida no queda nada creado y el permiso sigue vigente", async () => {
  const { db } = await fresh()
  const owner = await ownerWithGrant(db)
  const bad = { ...PAYLOAD, units: [PAYLOAD.units[0], { name: "Cabaña 2", capacity: 0, price: 1000 }] }
  assert.match((await complete(db, bad)).error, /INVALID_CAPACITY/)

  await as(db, "postgres")
  assert.equal((await one(db, "select count(*)::int n from organizations where slug = 'cabanas-del-lago'")).n, 0)
  assert.equal((await one(db, "select count(*)::int n from memberships where user_id = $1", [owner])).n, 0)
  assert.equal((await one(db, "select count(*)::int n from app_private.setup_grants where user_id = $1 and consumed_at is null", [owner])).n, 1)
  await db.close()
})

test("complete_setup valida cada campo", async () => {
  const { db } = await fresh()
  await ownerWithGrant(db)
  for (const [patch, code] of [
    [{ name: "X" }, /INVALID_NAME/],
    [{ slug: "demo" }, /INVALID_SLUG/],
    [{ slug: "con espacios" }, /INVALID_SLUG/],
    [{ slug: "doble--guion" }, /INVALID_SLUG/],
    [{ currency: "pesos" }, /INVALID_CURRENCY/],
    [{ timezone: "Marte/Olympus" }, /INVALID_TIMEZONE/],
    [{ checkin_time: "25:99" }, /INVALID_TIME/],
    [{ units: [] }, /INVALID_UNITS/],
    [{ units: null }, /INVALID_UNITS/],
    [{ units: [{ name: "A", capacity: 2, price: 10 }, { name: " a ", capacity: 2, price: 10 }] }, /DUPLICATE_UNIT_NAME/],
    [{ units: [{ name: "A", capacity: 2, price: 0 }] }, /INVALID_PRICE/],
    [{ units: [{ name: "A", capacity: 2, price: 10.555 }] }, /INVALID_PRICE/],
    [{ units: [{ name: "A", capacity: "muchos", price: 10 }] }, /INVALID_UNIT/],
  ]) {
    assert.match((await complete(db, { ...PAYLOAD, ...patch })).error ?? "", code, JSON.stringify(patch))
  }
  await db.close()
})

test("un slug tomado devuelve SLUG_TAKEN sin gastar el permiso", async () => {
  const { db } = await fresh()
  await ownerWithGrant(db)
  assert.equal((await one(db, "select setup_slug_available('alto-cielo') ok")).ok, false)
  assert.equal((await one(db, "select setup_slug_available('demo') ok")).ok, false)
  assert.equal((await one(db, "select setup_slug_available('cabanas-del-lago') ok")).ok, true)
  assert.match((await complete(db, { ...PAYLOAD, slug: "alto-cielo" })).error, /SLUG_TAKEN/)
  assert.equal((await one(db, "select my_onboarding_status() s")).s.has_grant, true)
  await db.close()
})

test("sin permiso de alta el asistente no hace nada", async () => {
  const { db } = await fresh()
  const curioso = await newUser(db, "curioso@e.test")
  await as(db, "authenticated", { uid: curioso })
  assert.equal((await one(db, "select my_onboarding_status() s")).s.has_grant, false)
  assert.match((await attempt(db, "select setup_save_draft('{}'::jsonb)")).error, /NO_GRANT/)
  assert.match((await attempt(db, "select setup_slug_available('algo')")).error, /NO_GRANT/)
  assert.match((await complete(db, PAYLOAD)).error, /NO_GRANT/)
  await db.close()
})

test("primeros pasos: el link lo marca cualquier miembro, ocultar la lista solo owner/admin", async () => {
  const { db, ids } = await fresh()
  await as(db, "authenticated", { uid: ids.staff_a })
  await db.query("select org_onboarding_mark($1, 'link_shared')", [ids.org_a])
  assert.match((await attempt(db, "select org_onboarding_mark($1, 'checklist_dismissed')", [ids.org_a])).error, /FORBIDDEN/)
  assert.match((await attempt(db, "select org_onboarding_mark($1, 'link_shared')", [ids.org_b])).error, /FORBIDDEN/)
  assert.match((await attempt(db, "select org_onboarding_mark($1, 'otra-cosa')", [ids.org_a])).error, /INVALID_EVENT/)

  await as(db, "authenticated", { uid: ids.admin_a })
  await db.query("select org_onboarding_mark($1, 'checklist_dismissed')", [ids.org_a])
  assert.deepEqual(
    await one(db, "select link_shared_at is not null shared, checklist_dismissed_at is not null dismissed from organizations where id = $1", [ids.org_a]),
    { shared: true, dismissed: true }
  )

  await as(db, "postgres")
  await db.query("insert into profiles (id, email) values ($1, 'owner_a@ejemplo.test') on conflict (id) do nothing", [ids.owner_a])
  await as(db, "authenticated", { uid: ids.owner_a })
  await db.query("select mark_tour_completed()")
  assert.equal((await one(db, "select tour_completed_at is not null done from profiles where id = $1", [ids.owner_a])).done, true)
  await db.close()
})
