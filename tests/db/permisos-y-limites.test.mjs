/**
 * Migración 0025: permisos por rol, límites de uso, extensiones de la
 * retención, aviso de pago sobre fecha revendida y acceso anónimo.
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

test("M-02: staff ve tarifas, unidades y configuración, pero no las cambia", async () => {
  const { db, ids } = await fresh()
  await as(db, "authenticated", { uid: ids.staff_a })
  assert.equal((await rows(db, "select id from rates")).length, 1)
  assert.equal((await rows(db, "select id from units")).length, 1)
  assert.equal((await rows(db, "select id from properties")).length, 1)

  const writes = [
    ["update rates set price_per_night = 1 returning id", []],
    ["delete from rates returning id", []],
    ["update units set name = 'X' returning id", []],
    ["update properties set deposit_pct = 0 returning id", []],
  ]
  for (const [sql] of writes) assert.deepEqual((await attempt(db, sql)).rows, [], sql)
  const insRate = await attempt(db,
    "insert into rates (organization_id, property_id, kind, price_per_night) values ($1, $2, 'base', 1)", [ids.org_a, ids.prop_a])
  assert.ok(insRate.error, "staff no crea tarifas")
  const insUnit = await attempt(db,
    "insert into units (organization_id, property_id, name) values ($1, $2, 'Nueva')", [ids.org_a, ids.prop_a])
  assert.ok(insUnit.error, "staff no crea unidades")
  const photo = await attempt(db,
    "insert into storage.objects (bucket_id, name) values ('unit-photos', $1)", [`${ids.org_a}/${ids.unit_a}/1.jpg`])
  assert.ok(photo.error, "staff no sube fotos")
  await db.close()
})

test("M-02: staff sí gestiona reservas y bloqueos", async () => {
  const { db, ids } = await fresh()
  await as(db, "authenticated", { uid: ids.staff_a })
  const [res] = await rows(db,
    "select id from create_manual_reservation($1, $2, $3, 'Pérez', null, null, '2027-05-01', '2027-05-03', 2, 'pending', null)",
    [ids.org_a, ids.prop_a, ids.unit_a])
  await rows(db, "select transition_reservation($1, 'confirmed')", [res.id])
  await rows(db, "select create_block($1, $2, '2027-06-01', '2027-06-02', 'Pintura')", [ids.org_a, ids.unit_a])
  assert.equal((await rows(db, "delete from unit_occupancy where block_reason = 'Pintura' returning id")).length, 1)
  await db.close()
})

test("M-02: owner y admin mantienen todos los permisos; nadie toca otra organización", async () => {
  const { db, ids } = await fresh()
  for (const user of [ids.owner_a, ids.admin_a]) {
    await as(db, "authenticated", { uid: user })
    assert.equal((await rows(db, "update rates set price_per_night = price_per_night returning id")).length, 1)
    assert.equal((await rows(db, "update units set name = name returning id")).length, 1)
    assert.equal((await rows(db, "update properties set deposit_pct = deposit_pct returning id")).length, 1)
    const photo = await attempt(db, "insert into storage.objects (bucket_id, name) values ('unit-photos', $1) returning id",
      [`${ids.org_a}/${ids.unit_a}/${user}.jpg`])
    assert.equal(photo.rows?.length, 1, "owner/admin suben fotos")
  }
  await as(db, "authenticated", { uid: ids.owner_a })
  assert.deepEqual((await attempt(db, "update units set name = 'X' where organization_id = $1 returning id", [ids.org_b])).rows, [])
  const foreign = await attempt(db, "insert into storage.objects (bucket_id, name) values ('unit-photos', $1)", [`${ids.org_b}/x/1.jpg`])
  assert.ok(foreign.error, "no sube a la carpeta de otra organización")
  await db.close()
})

test("A-03: quien llama directo a la reserva pública queda limitado por IP; la app no", async () => {
  const { db, ids } = await fresh()
  // Cuentan las reservas que se concretan (las que bloquean fechas): un
  // intento que falla revierte su transacción, contador incluido.
  let day = 1
  const book = () => {
    const from = `2027-01-${String(day).padStart(2, "0")}`, to = `2027-01-${String(day + 1).padStart(2, "0")}`
    day += 2
    return attempt(db, "select create_public_reservation('alto-cielo', null, $1, $2, $3, 1, 'X', null, null, null)", [ids.unit_a, from, to])
  }
  await as(db, "anon", { ip: "203.0.113.7" })
  for (let i = 0; i < 10; i++) assert.ok((await book()).rows, `reserva ${i + 1}`)
  assert.match((await book()).error, /RATE_LIMITED/)

  await as(db, "anon", { ip: "198.51.100.9" })
  assert.ok((await book()).rows, "otra IP tiene su propio cupo")

  await as(db, "service_role", { ip: "203.0.113.7" })
  assert.ok((await book()).rows, "la app (service_role) limita antes, por la IP del huésped")
  await db.close()
})

test("A-03: la consulta de estado por código cuenta también los códigos que no existen", async () => {
  const { db } = await fresh()
  await as(db, "anon", { ip: "203.0.113.7" })
  const status = () => attempt(db, "select public_reservation_status('alto-cielo', 'R-NOEXISTE') s")
  for (let i = 0; i < 120; i++) assert.equal((await status()).rows?.[0].s, null, `consulta ${i + 1}`)
  assert.match((await status()).error, /RATE_LIMITED/)
  await db.close()
})

test("A-03: el checkout extiende la retención 3 veces como máximo y nunca la acorta", async () => {
  const { db, ids } = await fresh()
  const [{ r }] = await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-01', '2027-03-04', 2, 'Ana', 'ana@e.test', null, null) r", [ids.unit_a])
  const [{ id, hold_expires_at: initial }] = await rows(db, "select id, hold_expires_at from reservations where code = $1", [r.code])
  const extend = async () => (await rows(db, "select extend_checkout_hold($1) ok", [id]))[0].ok
  assert.deepEqual([await extend(), await extend(), await extend(), await extend()], [true, true, true, false])
  const [{ hold_expires_at: after }] = await rows(db, "select hold_expires_at from reservations where id = $1", [id])
  assert.ok(new Date(after) >= new Date(initial), "no acorta los 30' de la reserva web")
  await as(db, "authenticated", { uid: ids.owner_a })
  assert.ok((await attempt(db, "select extend_checkout_hold($1)", [id])).error, "solo el servidor")
  await db.close()
})

test("A-02: el cupón de efectivo estira la retención hasta su vencimiento, con techo de 5 días", async () => {
  const { db, ids } = await fresh()
  const [{ r }] = await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-04-01', '2027-04-04', 2, 'Ana', 'ana@e.test', null, null) r", [ids.unit_a])
  const [{ id }] = await rows(db, "select id from reservations where code = $1", [r.code])
  const hold = async () => new Date((await rows(db, "select hold_expires_at h from reservations where id = $1", [id]))[0].h)
  const days = (d) => (d - Date.now()) / 86_400_000

  await rows(db, "select extend_hold_for_offline_payment($1, now() + interval '3 days')", [id])
  assert.ok(Math.abs(days(await hold()) - 3) < 0.01)
  await rows(db, "select extend_hold_for_offline_payment($1, now() + interval '30 days')", [id])
  assert.ok(Math.abs(days(await hold()) - 5) < 0.01, "techo de 5 días")
  assert.equal((await rows(db, "select extend_hold_for_offline_payment($1, now() + interval '1 day') ok", [id]))[0].ok, false, "nunca acorta")
  await db.close()
})

test("A-02: si un pago tardío cae sobre una fecha revendida, el propietario recibe un aviso", async () => {
  const { db, ids } = await fresh()
  const [{ r }] = await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-09-13', '2027-09-15', 2, 'Tarde', 'tarde@e.test', '+549111', null) r", [ids.unit_a])
  const [{ id }] = await rows(db, "select id from reservations where code = $1", [r.code])
  await db.query("insert into payments (organization_id, reservation_id, kind, amount, status, paid_at) values ($1, $2, 'deposit', 100000, 'paid', now())", [ids.org_a, id])
  await db.query("update reservations set hold_expires_at = now() - interval '1 minute' where id = $1", [id])
  await db.query("select expire_stale_holds()")
  await db.query("select create_public_reservation('alto-cielo', null, $1, '2027-09-13', '2027-09-15', 2, 'Otro', 'o@e.test', null, null)", [ids.unit_a])

  assert.equal((await rows(db, "select recover_paid_expired_reservation($1) r", [id]))[0].r, "UNAVAILABLE")
  const [notice] = await rows(db,
    "select recipient_email, delivery_status, payload from notification_outbox where reservation_id = $1 and event_type = 'payment_orphaned_admin'", [id])
  assert.equal(notice.recipient_email, "duenio-a@ejemplo.test")
  assert.equal(notice.delivery_status, "pending")
  assert.equal(Number(notice.payload.paid_amount), 100000)
  assert.equal(notice.payload.guest_email, "tarde@e.test")
  assert.equal(notice.payload.guest_phone, "+549111")
  // Un reintento del webhook no duplica el aviso.
  await rows(db, "select recover_paid_expired_reservation($1)", [id])
  assert.equal((await rows(db, "select count(*)::int n from notification_outbox where event_type = 'payment_orphaned_admin'"))[0].n, 1)
  await db.close()
})

test("advisors: las funciones del panel ya no se ejecutan sin sesión", async () => {
  const { db, ids } = await fresh()
  await as(db, "anon", { ip: "203.0.113.7" })
  for (const [sql, params] of [
    ["select create_block($1, $2, '2027-01-01', '2027-01-02', null)", [ids.org_a, ids.unit_a]],
    ["select transition_reservation(gen_random_uuid(), 'confirmed')", []],
    ["select simulate_price($1, '2027-01-01', '2027-01-02', 2)", [ids.unit_a]],
    ["select is_member_of($1)", [ids.org_a]],
    ["select shares_org($1)", [ids.owner_a]],
  ]) {
    assert.match((await attempt(db, sql, params)).error ?? "", /permission denied/, sql)
  }
  // Lo público sigue abierto.
  assert.ok((await attempt(db, "select public_availability('alto-cielo', null, '2027-01-01', '2027-01-02', 1)")).rows)
  await db.close()
})

test("deriva: _can_transition acepta pasar a expired como en producción, y de expired no se sale", async () => {
  const { db } = await fresh()
  const can = async (from, to) => (await rows(db, "select _can_transition($1, $2) ok", [from, to]))[0].ok
  assert.equal(await can("pending", "expired"), true)
  assert.equal(await can("pending_payment", "expired"), true)
  assert.equal(await can("expired", "confirmed"), false)
  assert.equal(await can("expired", "pending"), false)
  await db.close()
})
