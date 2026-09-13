/**
 * Panel interno de Operon (migración 0027): listado de clientes, contra el
 * esquema real en PGlite.
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

test("solo un platform admin ve el listado de clientes", async () => {
  const { db, ids } = await fresh()
  for (const [role, uid] of [["anon", ""], ["authenticated", ids.owner_a], ["authenticated", ids.staff_a]]) {
    await as(db, role, { uid })
    assert.ok((await attempt(db, "select * from operon_clients()")).error, `${role} ${uid}`)
  }
  await db.close()
})

test("cada cliente trae dueño, unidades, reservas del mes y cobros", async () => {
  const { db, ids } = await fresh()

  await as(db, "postgres")
  const [admin] = await rows(db, "insert into auth.users (email) values ('santiago@operonhub.test') returning id")
  await db.query("insert into platform_admins (user_id) values ($1)", [admin.id])
  await db.query("insert into profiles (id, email, full_name) values ($1, 'owner_a@ejemplo.test', 'Lucía Herrera') on conflict (id) do update set full_name = excluded.full_name", [ids.owner_a])

  // Una reserva confirmada este mes con la seña cobrada, una cancelada que no
  // cuenta como "del mes", y una de otro mes. Insertadas directo: con
  // create_manual_reservation el test dependería del día en que corre.
  const monthStart = "date_trunc('month', now() at time zone 'America/Argentina/Cordoba')::date"
  const insert = (code, checkIn, status) =>
    rows(db,
      `insert into reservations (organization_id, property_id, unit_id, code, check_in, check_out, status)
       values ($1, $2, $3, $4, ${checkIn}, ${checkIn} + 2, $5) returning id`,
      [ids.org_a, ids.prop_a, ids.unit_a, code, status])
  const [[ok]] = await Promise.all([insert("R-MES001", monthStart, "confirmed")])
  await insert("R-MES002", monthStart, "cancelled")
  await insert("R-OTRO01", `${monthStart} - 40`, "completed")
  await db.query(
    "insert into payments (organization_id, reservation_id, kind, amount, status, paid_at) values ($1, $2, 'deposit', 150000, 'paid', now())",
    [ids.org_a, ok.id])
  await db.query("update organizations set link_shared_at = now() where id = $1", [ids.org_a])

  await as(db, "authenticated", { uid: admin.id })
  const list = await rows(db, "select * from operon_clients()")
  assert.equal(list.length, 2)

  const a = list.find((c) => c.slug === "alto-cielo")
  assert.equal(a.owner_email, "owner_a@ejemplo.test")
  assert.equal(a.owner_name, "Lucía Herrera")
  assert.equal(a.members, 3)
  assert.equal(a.units, 1)
  assert.equal(a.reservations_total, 3)
  assert.equal(a.reservations_month, 1)
  assert.equal(Number(a.paid_month), 150000)
  assert.equal(a.currency, "ARS")
  assert.equal(Number(a.deposit_pct), 50)
  assert.equal(a.mp_connected, false)
  assert.equal(a.link_shared, true)
  assert.ok(a.last_reservation_at)

  const b = list.find((c) => c.slug === "otra-cabana")
  assert.equal(b.reservations_total, 0)
  assert.equal(Number(b.paid_month), 0)
  assert.equal(b.link_shared, false)
  await db.close()
})
