/**
 * Panel interno de Operon (migración 0033): ficha, suspensión, soporte de
 * cuentas y registro de acciones, contra el esquema real en PGlite.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { createDb, as, attempt } from "./harness.mjs"
import { seed } from "./seed.mjs"

async function fresh() {
  const db = await createDb()
  const ids = await seed(db)
  await as(db, "postgres")
  const admin = (await one(db, "insert into auth.users (email) values ('santiago@operonhub.test') returning id")).id
  await db.query("insert into platform_admins (user_id) values ($1)", [admin])
  return { db, ids, admin }
}
const rows = async (db, sql, params) => (await db.query(sql, params)).rows
const one = async (db, sql, params) => (await rows(db, sql, params))[0]
const log = async (db) => {
  await as(db, "postgres")
  return rows(db, "select * from app_private.admin_audit_log order by id")
}

const ADMIN_CALLS = [
  ["select operon_client_detail($1)", (ids) => [ids.org_a]],
  ["select * from operon_audit_log()", () => []],
  ["select operon_suspend_org($1, 'motivo')", (ids) => [ids.org_a]],
  ["select operon_reactivate_org($1)", (ids) => [ids.org_a]],
  ["select operon_remove_member($1, $2, 'motivo')", (ids) => [ids.org_a, ids.staff_a]],
  ["select operon_prepare_recovery($1, $2)", (ids) => [ids.org_a, ids.owner_a]],
]

test("las RPC del panel son solo para platform admins", async () => {
  const { db, ids } = await fresh()
  for (const [role, uid] of [["anon", ""], ["authenticated", ids.owner_a], ["authenticated", ids.staff_a]]) {
    await as(db, role, { uid })
    for (const [sql, params] of ADMIN_CALLS) {
      assert.ok((await attempt(db, sql, params(ids))).error, `${role} ${uid}: ${sql}`)
    }
    assert.ok((await attempt(db, "select * from app_private.admin_audit_log")).error, `${role} lee el registro`)
  }
  // Nada de lo anterior tocó datos.
  await as(db, "postgres")
  assert.equal((await one(db, "select suspended_at from organizations where id = $1", [ids.org_a])).suspended_at, null)
  assert.equal((await one(db, "select count(*)::int n from memberships where organization_id = $1", [ids.org_a])).n, 3)
  await db.close()
})

test("la ficha no trae montos: ni cobros, ni totales, ni señas, ni tarifas", async () => {
  const { db, ids, admin } = await fresh()
  const [{ r }] = await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-01', '2027-03-04', 2, 'Ana Gómez', 'ana@e.test', null, null) r",
    [ids.unit_a])
  await as(db, "postgres")
  const res = await one(db, "select id from reservations where organization_id = $1", [ids.org_a])
  await db.query(
    "insert into payments (organization_id, reservation_id, kind, amount, status, paid_at) values ($1, $2, 'deposit', 150000, 'paid', now())",
    [ids.org_a, res.id])

  await as(db, "authenticated", { uid: admin })
  const { operon_client_detail: d } = await one(db, "select operon_client_detail($1)", [ids.org_a])

  assert.equal(d.org.slug, "alto-cielo")
  assert.equal(d.members.length, 3)
  assert.equal(d.members[0].role, "owner")
  assert.equal(d.units.length, 1)
  assert.equal(d.units[0].airbnb_configured, false)
  assert.equal(d.properties[0].deposit_configured, true)
  assert.equal(d.reservations.total, 1)
  assert.equal(d.reservations.recent[0].guest_name, "Ana Gómez")
  assert.equal(d.reservations.recent[0].code, r.code)
  assert.equal(d.mercadopago.connected, false)

  const text = JSON.stringify(d)
  assert.doesNotMatch(text, /amount|paid|price|deposit_pct|total_amount|150000|300000/)
  assert.doesNotMatch(text, /ical_url|ical_token/)
  await db.close()
})

test("suspender corta las reservas nuevas pero no /pago, el feed iCal ni la gestión de reservas", async () => {
  const { db, ids, admin } = await fresh()
  const [{ r }] = await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-01', '2027-03-04', 2, 'Ana', 'ana@e.test', null, null) r",
    [ids.unit_a])

  await as(db, "authenticated", { uid: admin })
  assert.match((await attempt(db, "select operon_suspend_org($1, '  ')", [ids.org_a])).error, /REASON_REQUIRED/)
  await db.query("select operon_suspend_org($1, 'No pagó septiembre')", [ids.org_a])
  assert.match((await attempt(db, "select operon_suspend_org($1, 'otra vez')", [ids.org_a])).error, /ALREADY_SUSPENDED/)

  await as(db, "anon")
  for (const sql of [
    "select public_property('alto-cielo', null)",
    "select * from public_availability('alto-cielo', null, '2027-04-01', '2027-04-03', 2)",
    `select create_public_reservation('alto-cielo', null, '${ids.unit_a}', '2027-05-01', '2027-05-03', 2, 'X', 'x@e.test', null, null)`,
  ]) {
    assert.match((await attempt(db, sql)).error, /ORG_SUSPENDED/, sql)
  }
  // Lo que ya está en curso sigue: el huésped consulta su reserva y paga.
  const status = await one(db, "select public_reservation_status('alto-cielo', $1) s", [r.code])
  assert.ok(status.s)
  // El calendario exportado sigue saliendo (si no, Airbnb reabriría las fechas).
  await as(db, "postgres")
  const { ical_token } = await one(db, "select ical_token from units where id = $1", [ids.unit_a])
  await as(db, "anon")
  assert.equal((await one(db, "select public_ical_feed($1, $2) f", [ids.unit_a, ical_token])).f.found, true)

  // La importación de calendarios se pausa.
  await as(db, "postgres")
  await db.query("update units set airbnb_ical_url = 'https://www.airbnb.com/calendar/ical/1.ics' where id in ($1, $2)", [ids.unit_a, ids.unit_b])
  await as(db, "service_role")
  const synced = (await rows(db, "select unit_id from list_units_for_ical_sync()")).map((x) => x.unit_id)
  assert.deepEqual(synced, [ids.unit_b])

  // El dueño lee que está suspendido, pero no se puede reactivar solo.
  await as(db, "authenticated", { uid: ids.owner_a })
  assert.ok((await one(db, "select suspended_at from organizations where id = $1", [ids.org_a])).suspended_at)
  await attempt(db, "update organizations set suspended_at = null where id = $1", [ids.org_a])
  await as(db, "postgres")
  assert.ok((await one(db, "select suspended_at from organizations where id = $1", [ids.org_a])).suspended_at)

  // Reactivar devuelve todo a la normalidad.
  await as(db, "authenticated", { uid: admin })
  await db.query("select operon_reactivate_org($1, 'Pagó')", [ids.org_a])
  assert.match((await attempt(db, "select operon_reactivate_org($1)", [ids.org_a])).error, /NOT_SUSPENDED/)
  await as(db, "anon")
  assert.ok((await attempt(db, "select * from public_availability('alto-cielo', null, '2027-04-01', '2027-04-03', 2)")).rows)

  const entries = await log(db)
  assert.deepEqual(entries.map((e) => e.action), ["org.suspend", "org.reactivate"])
  assert.equal(entries[0].actor_email, "santiago@operonhub.test")
  assert.equal(entries[0].reason, "No pagó septiembre")
  assert.equal(entries[1].reason, "Pagó")

  // Mientras estuvo suspendido, la ficha mostraba el motivo.
  await as(db, "authenticated", { uid: admin })
  await db.query("select operon_suspend_org($1, 'Pidió pausa')", [ids.org_b])
  const { operon_client_detail: d } = await one(db, "select operon_client_detail($1)", [ids.org_b])
  assert.equal(d.org.suspension.reason, "Pidió pausa")
  assert.equal(d.org.suspension.actor_email, "santiago@operonhub.test")
  // Y el listado lo manda al final.
  const list = await rows(db, "select slug, suspended_at from operon_clients()")
  assert.equal(list.at(-1).slug, "otra-cabana")
  await db.close()
})

test("quitar miembros: nunca el último dueño, y queda registrado", async () => {
  const { db, ids, admin } = await fresh()
  await as(db, "authenticated", { uid: admin })

  assert.match((await attempt(db, "select operon_remove_member($1, $2, 'Se fue')", [ids.org_a, ids.owner_a])).error, /LAST_OWNER/)
  assert.match((await attempt(db, "select operon_remove_member($1, $2, 'Se fue')", [ids.org_a, ids.owner_b])).error, /NOT_A_MEMBER/)
  assert.match((await attempt(db, "select operon_remove_member($1, $2, '')", [ids.org_a, ids.staff_a])).error, /REASON_REQUIRED/)

  await db.query("select operon_remove_member($1, $2, 'Ya no trabaja ahí')", [ids.org_a, ids.staff_a])
  await as(db, "postgres")
  assert.equal((await one(db, "select count(*)::int n from memberships where user_id = $1", [ids.staff_a])).n, 0)
  // La cuenta queda: solo se quita el acceso al complejo.
  assert.equal((await one(db, "select count(*)::int n from auth.users where id = $1", [ids.staff_a])).n, 1)

  // Con dos dueños, uno se puede quitar.
  await db.query("update memberships set role = 'owner' where user_id = $1", [ids.admin_a])
  await as(db, "authenticated", { uid: admin })
  await db.query("select operon_remove_member($1, $2, 'Cambio de dueño')", [ids.org_a, ids.owner_a])

  const entries = await log(db)
  assert.deepEqual(entries.map((e) => [e.action, e.target_email]), [
    ["member.remove", "staff_a@ejemplo.test"],
    ["member.remove", "owner_a@ejemplo.test"],
  ])
  assert.equal(entries[0].detail.role, "staff")
  await db.close()
})

test("link de nueva contraseña: solo miembros del complejo, nunca otro admin, y se registra", async () => {
  const { db, ids, admin } = await fresh()
  await as(db, "authenticated", { uid: admin })

  const { email } = await one(db, "select operon_prepare_recovery($1, $2) email", [ids.org_a, ids.owner_a])
  assert.equal(email, "owner_a@ejemplo.test")
  assert.match((await attempt(db, "select operon_prepare_recovery($1, $2)", [ids.org_a, ids.owner_b])).error, /NOT_A_MEMBER/)

  // Un admin de Operon que además es miembro de un complejo no se puede resetear desde el panel.
  await as(db, "postgres")
  await db.query("insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [ids.org_b, admin])
  await as(db, "authenticated", { uid: admin })
  assert.match((await attempt(db, "select operon_prepare_recovery($1, $2)", [ids.org_b, admin])).error, /TARGET_IS_PLATFORM_ADMIN/)

  const entries = await log(db)
  assert.deepEqual(entries.map((e) => [e.action, e.target_email]), [["member.recovery_link", "owner_a@ejemplo.test"]])
  await db.close()
})

test("las invitaciones de un admin quedan en el registro; el canje no", async () => {
  const { db, admin } = await fresh()
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex")
  await as(db, "authenticated", { uid: admin })
  const { id } = await one(db, "select invitation_create($1, null, 'Cabañas del Lago') id", [hash])
  await db.query("select invitation_revoke($1)", [id])

  const hash2 = createHash("sha256").update(randomBytes(32)).digest("hex")
  await db.query("select invitation_create($1, null, 'Otro') id", [hash2])
  await as(db, "postgres")
  const user = (await one(db, "insert into auth.users (email) values ('nuevo@e.test') returning id")).id
  await as(db, "service_role")
  await db.query("select invitation_redeem($1, $2)", [hash2, user])

  const entries = await log(db)
  assert.deepEqual(entries.map((e) => [e.action, e.detail.note]), [
    ["invitation.create", "Cabañas del Lago"],
    ["invitation.revoke", "Cabañas del Lago"],
    ["invitation.create", "Otro"],
  ])

  await as(db, "authenticated", { uid: admin })
  const visible = await rows(db, "select action from operon_audit_log(null, 2)")
  assert.deepEqual(visible.map((e) => e.action), ["invitation.create", "invitation.revoke"])
  await db.close()
})

test("salud de mails: cuenta fallas y atascos sin exponer el contenido", async () => {
  const { db, ids, admin } = await fresh()
  await rows(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-01', '2027-03-04', 2, 'Ana', 'ana@e.test', null, null) r",
    [ids.unit_a])
  await as(db, "postgres")
  const { id: res } = await one(db, "select id from reservations where organization_id = $1", [ids.org_a])
  const outbox = (key, status, extra) => db.query(
    `insert into notification_outbox (organization_id, reservation_id, event_type, idempotency_key, payload,
       delivery_status, next_attempt_at, last_error, processing_started_at)
     values ($1, $2, 'reservation_status_guest', $3, '{"total_amount": 300000}', $4, $5, $6, $7)`,
    [ids.org_a, res, key, status, extra.next ?? null, extra.error ?? null, extra.started ?? null])
  await outbox("k1", "failed", { error: "Resend 403: " + "x".repeat(400) })
  await outbox("k2", "failed", { next: new Date(Date.now() + 60_000), error: "timeout" })
  await outbox("k3", "processing", { started: new Date(Date.now() - 2 * 3600_000) })
  await outbox("k4", "sent", {})

  await as(db, "authenticated", { uid: admin })
  const a = (await rows(db, "select * from operon_clients()")).find((c) => c.slug === "alto-cielo")
  assert.equal(a.email_failed_30d, 1)
  assert.equal(a.email_stuck, 1)

  const { operon_client_detail: d } = await one(db, "select operon_client_detail($1)", [ids.org_a])
  assert.equal(d.email_health.failed_final, 1)
  assert.equal(d.email_health.retrying, 1)
  assert.equal(d.email_health.stuck, 1)
  assert.ok(d.email_health.last_error.length <= 200)
  assert.doesNotMatch(JSON.stringify(d.email_health), /300000|total_amount/)
  await db.close()
})
