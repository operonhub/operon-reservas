/**
 * Migración 0046: editar, cancelar y eliminar reservas desde el panel, contra
 * el esquema real en PGlite.
 *
 * Lo que tiene que cumplirse siempre (se verifica después de cada operación):
 *  - toda reserva que retiene fechas tiene UNA ocupación con su unidad y sus fechas;
 *  - ninguna ocupación pertenece a una reserva que no retiene fechas;
 *  - dos ocupaciones de una misma unidad nunca se pisan (restricción EXCLUDE).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDb, as, attempt } from "./harness.mjs"
import { seed } from "./seed.mjs"
import { RESERVATION_TRANSITIONS } from "../../src/lib/constants.ts"

const rows = async (db, sql, params) => (await db.query(sql, params)).rows
const one = async (db, sql, params) => (await rows(db, sql, params))[0]

async function fresh() {
  const db = await createDb()
  const ids = await seed(db)
  // Una segunda unidad en el mismo complejo (más chica y más cara) y otra inactiva.
  const [u2] = await rows(db,
    "insert into units (organization_id, property_id, name, capacity) values ($1, $2, 'Cabaña A2', 2) returning id",
    [ids.org_a, ids.prop_a])
  ids.unit_a2 = u2.id
  await db.query(
    `insert into rates (organization_id, property_id, unit_id, kind, label, price_per_night, min_nights, is_active)
     values ($1, $2, $3, 'base', 'Tarifa base', 200000, 1, true)`,
    [ids.org_a, ids.prop_a, ids.unit_a2])
  const [u3] = await rows(db,
    "insert into units (organization_id, property_id, name, capacity, is_active) values ($1, $2, 'Cabaña vieja', 4, false) returning id",
    [ids.org_a, ids.prop_a])
  ids.unit_off = u3.id
  return { db, ids }
}

const who = (db, ids, key) => as(db, "authenticated", { uid: ids[key] })

/** Corre algo con otro rol (postgres por defecto) y deja el rol como estaba. */
async function peek(db, fn, role = "postgres") {
  const { uid, role: current } = (await db.query("select current_setting('test.uid', true) uid, current_setting('test.role', true) role")).rows[0]
  await as(db, role)
  try { return await fn() } finally { await as(db, current || "postgres", { uid: uid || "" }) }
}

/** Un pago cargado directo en la base (el panel no puede escribir en payments). */
const pay = (db, ids, reservation, { amount = 100000, status = "paid", link = null, kind = "deposit" } = {}) =>
  peek(db, () => db.query(
    "insert into payments (organization_id, reservation_id, kind, amount, currency, status, mp_init_point, paid_at) values ($1, $2, $3, $4, 'ARS', $5, $6, $7)",
    [ids.org_a, reservation, kind, amount, status, link, status === "paid" ? new Date().toISOString() : null]))

/** Carga una reserva manual como owner y devuelve su id. */
async function book(db, ids, { unit, from, to, guests = 2, status = "confirmed", name = "Ana Pérez", email = "ana@e.test", phone = null } = {}) {
  await who(db, ids, "owner_a")
  const [r] = await rows(db,
    "select id from create_manual_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null)",
    [ids.org_a, ids.prop_a, unit ?? ids.unit_a, name, email, phone, from, to, guests, status])
  return r.id
}

const update = (db, id, f) =>
  db.query("select update_reservation($1, $2, $3, $4, $5, $6, $7, $8, $9) r",
    [id, f.unit, f.from, f.to, f.guests, f.name, f.email ?? null, f.phone ?? null, f.notes ?? null])
    .then((x) => x.rows[0].r)

/** Los datos de la reserva tal cual están, para comparar "no cambió nada". */
const snapshot = (db, id) => peek(db, async () => (await rows(db,
  `select r.unit_id, r.check_in::text, r.check_out::text, r.guests_count, r.total_amount, r.deposit_amount, r.guest_id, r.status,
          (select count(*)::int from unit_occupancy o where o.reservation_id = r.id) occ,
          (select lower(during)::text || '/' || upper(during)::text from unit_occupancy o where o.reservation_id = r.id) during
     from reservations r where r.id = $1`, [id]))[0])

/** Reglas que tienen que cumplirse después de CUALQUIER operación. */
const invariants = (db, label = "") => peek(db, async () => {
  const missing = await rows(db,
    `select r.code from reservations r
      where holds_inventory(r.status)
        and (select count(*) from unit_occupancy o
              where o.reservation_id = r.id and o.unit_id = r.unit_id
                and o.during = daterange(r.check_in, r.check_out, '[)')) <> 1`)
  assert.deepEqual(missing, [], `${label}: reservas que retienen fechas sin su ocupación`)
  const stray = await rows(db,
    `select o.id from unit_occupancy o join reservations r on r.id = o.reservation_id
      where not holds_inventory(r.status)`)
  assert.deepEqual(stray, [], `${label}: ocupaciones de reservas que no retienen fechas`)
  const extra = await rows(db, `select o.id from unit_occupancy o where o.kind = 'reservation' and o.reservation_id is null`)
  assert.deepEqual(extra, [], `${label}: ocupación de reserva sin reserva`)
})

/** ¿La web pública ofrece esa unidad en esas fechas? */
const offered = (db, ids, unit, from, to, guests = 1) => peek(db, async () =>
  (await rows(db, "select unit_id from public_availability('alto-cielo', null, $1, $2, $3)", [from, to, guests]))
    .some((r) => r.unit_id === unit), "anon")

const audit = (db, code) => peek(db, () => rows(db,
  "select action, actor_id, detail from app_private.reservation_audit where reservation_code = $1 order by id", [code]))

const codeOf = (db, id) => peek(db, async () => (await one(db, "select code from reservations where id = $1", [id])).code)

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

test("estados: el cliente y la base ofrecen exactamente las mismas transiciones", async () => {
  const { db } = await fresh()
  const all = ["inquiry", "pending", "pending_payment", "confirmed", "completed", "cancelled", "expired"]
  for (const from of all) {
    for (const to of all) {
      const sql = (await one(db, "select _can_transition($1::reservation_status, $2::reservation_status) ok", [from, to])).ok
      const ts = RESERVATION_TRANSITIONS[from].includes(to)
      // Todo lo que ofrece el panel, la base lo acepta.
      if (ts) assert.equal(sql, true, `${from} → ${to}: el panel lo ofrece y la base no`)
      // Lo único que la base acepta de más es 'expired', que maneja solo el sistema.
      if (sql && !ts) assert.equal(to, "expired", `${from} → ${to}: la base lo acepta y el panel no lo ofrece`)
    }
  }
  // Los tres finales de verdad no tienen salida; "Completada" se puede reabrir o cancelar.
  assert.deepEqual(RESERVATION_TRANSITIONS.completed, ["confirmed", "cancelled"])
  assert.deepEqual(RESERVATION_TRANSITIONS.cancelled, [])
  assert.deepEqual(RESERVATION_TRANSITIONS.expired, [])
  await db.close()
})

test("cancelar una reserva Completada libera el calendario y el buscador público", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-13" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'completed')", [id])
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-10", "2027-03-13"), false, "Completada sigue ocupando")

  await who(db, ids, "staff_a")
  await db.query("select transition_reservation($1, 'cancelled')", [id])
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-10", "2027-03-13"), true, "cancelada libera")
  assert.equal((await one(db, "select count(*)::int n from unit_occupancy where reservation_id = $1", [id])).n, 0)
  await invariants(db, "cancelar desde Completada")
  await db.close()
})

test("reabrir una Completada la deja Confirmada y ocupando las mismas fechas", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-13" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'completed')", [id])
  await db.query("select transition_reservation($1, 'confirmed')", [id])
  const s = await snapshot(db, id)
  assert.deepEqual([s.status, s.occ, s.during], ["confirmed", 1, "2027-03-10/2027-03-13"])
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-10", "2027-03-13"), false)
  await invariants(db, "reabrir")
  await db.close()
})

test("cancelada y expirada no tienen salida", async () => {
  const { db, ids } = await fresh()
  const a = await book(db, ids, { from: "2027-04-01", to: "2027-04-03" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'cancelled')", [a])
  for (const to of ["confirmed", "pending", "completed", "cancelled"]) {
    assert.match((await attempt(db, "select transition_reservation($1, $2)", [a, to])).error, /INVALID_TRANSITION/, to)
  }
  const b = await book(db, ids, { from: "2027-05-01", to: "2027-05-03", status: "pending" })
  await as(db, "service_role")
  await db.query("select transition_reservation($1, 'expired')", [b])
  for (const to of ["confirmed", "pending", "cancelled"]) {
    assert.match((await attempt(db, "select transition_reservation($1, $2)", [b, to])).error, /INVALID_TRANSITION/, to)
  }
  await invariants(db, "finales")
  await db.close()
})

test("cancelar y reabrir quedan registrados con quién lo hizo y cuánto estaba cobrado", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  const code = await codeOf(db, id)
  await pay(db, ids, id)
  await who(db, ids, "admin_a")
  await db.query("select transition_reservation($1, 'completed')", [id])
  await db.query("select transition_reservation($1, 'confirmed')", [id])
  await db.query("select transition_reservation($1, 'cancelled')", [id])
  const log = await audit(db, code)
  assert.deepEqual(log.map((l) => l.action), ["reopened", "cancelled"])
  assert.ok(log.every((l) => l.actor_id === ids.admin_a))
  assert.equal(Number(log[1].detail.paid_amount), 100000)
  assert.equal(log[1].detail.from, "confirmed")
  // Los pagos no se tocan al cancelar.
  assert.equal((await one(db, "select count(*)::int n from payments where reservation_id = $1 and status = 'paid'", [id])).n, 1)
  await db.close()
})

// ---------------------------------------------------------------------------
// Avisos por mail
// ---------------------------------------------------------------------------

const guestMail = (db, id) => peek(db, () => rows(db,
  "select delivery_status, last_error, recipient_email from notification_outbox where reservation_id = $1 and event_type = 'reservation_status_guest' order by created_at, id", [id]))

test("avisos: cancelar avisa al huésped, salvo que se pida no avisar", async () => {
  const { db, ids } = await fresh()
  const a = await book(db, ids, { from: "2027-04-01", to: "2027-04-03", email: "a@e.test" })
  const b = await book(db, ids, { from: "2027-04-10", to: "2027-04-12", email: "b@e.test", name: "Beto" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'cancelled')", [a])
  await db.query("select transition_reservation($1, 'cancelled', false)", [b])
  assert.deepEqual(await guestMail(db, a), [{ delivery_status: "pending", last_error: null, recipient_email: "a@e.test" }])
  assert.deepEqual(await guestMail(db, b), [{ delivery_status: "skipped", last_error: "NOT_NOTIFIED_BY_CHOICE", recipient_email: "b@e.test" }])
  await db.close()
})

test("avisos: reabrir y cancelar desde Completada son correcciones internas, no avisan", async () => {
  const { db, ids } = await fresh()
  const a = await book(db, ids, { from: "2027-04-01", to: "2027-04-03", email: "a@e.test" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'completed')", [a])
  await db.query("select transition_reservation($1, 'confirmed')", [a])   // reabrir
  await db.query("select transition_reservation($1, 'completed')", [a])
  await db.query("select transition_reservation($1, 'cancelled')", [a])   // cancelar desde Completada
  const mails = await guestMail(db, a)
  // El cierre normal (confirmed → completed) sí es una novedad y se manda UNA vez
  // (el segundo cierre repite el mismo aviso y no se duplica). Lo que sale de
  // "Completada" —reabrir o cancelar— queda sin enviar y con el motivo.
  assert.equal(mails.filter((m) => m.delivery_status === "pending").length, 1)
  const silenced = mails.filter((m) => m.delivery_status === "skipped")
  assert.equal(silenced.length, 2)
  assert.ok(silenced.every((m) => m.last_error === "NOT_NOTIFIED_BY_CHOICE"))
  await db.close()
})

test("avisos: editar refresca los avisos pendientes y no manda ninguno nuevo", async () => {
  const { db, ids } = await fresh()
  // Una reserva de la web propia deja un aviso pendiente para el dueño.
  await as(db, "anon")
  const { r } = await one(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-06-01', '2027-06-03', 2, 'Luz Gómez', 'luz@e.test', null, null) r", [ids.unit_a])
  await as(db, "postgres")
  const id = (await one(db, "select id from reservations where code = $1", [r.code])).id
  const before = await rows(db, "select event_type, delivery_status from notification_outbox where reservation_id = $1 order by id", [id])
  assert.deepEqual(before, [{ event_type: "reservation_created_admin", delivery_status: "pending" }])

  await who(db, ids, "owner_a")
  await update(db, id, { unit: ids.unit_a2, from: "2027-06-05", to: "2027-06-08", guests: 2, name: "Luz Gómez", email: "luz@e.test" })
  await as(db, "postgres")
  const after = await rows(db, "select event_type, delivery_status, payload from notification_outbox where reservation_id = $1 order by id", [id])
  assert.equal(after.length, 1, "no se agregó ningún aviso")
  assert.equal(after[0].delivery_status, "pending")
  assert.equal(after[0].payload.unit_name, "Cabaña A2")
  assert.equal(after[0].payload.check_in, "2027-06-05")
  assert.equal(Number(after[0].payload.total_amount), 600000)
  await db.close()
})

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

test("editar: cambiar de cabaña mueve la ocupación, recalcula el precio y refleja el buscador público", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", guests: 2 })
  assert.equal(Number((await snapshot(db, id)).total_amount), 200000)

  await who(db, ids, "owner_a")
  const res = await update(db, id, { unit: ids.unit_a2, from: "2027-03-10", to: "2027-03-12", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.equal(res.changed, true)
  assert.equal(res.unit_name, "Cabaña A2")
  assert.equal(Number(res.total_amount), 400000)   // 2 noches × 200.000, la tarifa de la cabaña nueva
  assert.equal(Number(res.deposit_amount), 200000) // 50% de seña
  assert.equal(Number(res.balance), 400000)

  const s = await snapshot(db, id)
  assert.deepEqual([s.unit_id, s.occ, s.during], [ids.unit_a2, 1, "2027-03-10/2027-03-12"])
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-10", "2027-03-12"), true, "la cabaña vieja quedó libre")
  assert.equal(await offered(db, ids, ids.unit_a2, "2027-03-10", "2027-03-12"), false, "la nueva quedó ocupada")
  await invariants(db, "cambiar de cabaña")

  const log = await audit(db, await codeOf(db, id))
  assert.deepEqual(log.map((l) => l.action), ["updated"])
  assert.deepEqual(log[0].detail.unit, { from: "Cabaña A", to: "Cabaña A2" })
  await db.close()
})

test("editar: cambiar fechas y huéspedes; se puede estirar sobre las propias fechas", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", guests: 2 })
  await who(db, ids, "owner_a")
  // Estirar un día pisa sus propias fechas: no es un conflicto.
  const res = await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-13", guests: 3, name: "Ana Pérez", email: "ana@e.test" })
  assert.equal(Number(res.total_amount), 300000)
  const s = await snapshot(db, id)
  assert.deepEqual([s.guests_count, s.during], [3, "2027-03-10/2027-03-13"])
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-12", "2027-03-13"), false)
  // Y acortar libera lo que sobra.
  await update(db, id, { unit: ids.unit_a, from: "2027-03-11", to: "2027-03-12", guests: 3, name: "Ana Pérez", email: "ana@e.test" })
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-10", "2027-03-11"), true)
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-12", "2027-03-13"), true)
  await invariants(db, "fechas")
  await db.close()
})

test("editar: si las fechas están ocupadas se rechaza y no cambia NADA", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  await book(db, ids, { from: "2027-03-20", to: "2027-03-23", name: "Otro", email: "otro@e.test" })
  await who(db, ids, "owner_a")
  await db.query("select create_block($1, $2, '2027-04-01', '2027-04-04', 'Pintura')", [ids.org_a, ids.unit_a])
  await as(db, "postgres")
  // Una fecha importada de Booking en la otra cabaña.
  await db.query(
    "insert into unit_occupancy (organization_id, unit_id, during, kind, external_source, external_uid) values ($1, $2, '[2027-05-01,2027-05-04)', 'block', 'booking', 'ext@b')",
    [ids.org_a, ids.unit_a2])

  const before = await snapshot(db, id)
  await who(db, ids, "owner_a")
  for (const [unit, from, to] of [
    [ids.unit_a, "2027-03-21", "2027-03-24"],   // pisa otra reserva
    [ids.unit_a, "2027-04-02", "2027-04-05"],   // pisa un bloqueo
    [ids.unit_a2, "2027-05-02", "2027-05-05"],  // pisa una fecha importada
  ]) {
    const e = await attempt(db, "select update_reservation($1, $2, $3, $4, 2, 'Ana Pérez', 'ana@e.test', null, null)", [id, unit, from, to])
    assert.match(e.error, /UNAVAILABLE/, `${unit} ${from}`)
  }
  assert.deepEqual(await snapshot(db, id), before, "la reserva quedó exactamente igual")
  await invariants(db, "conflictos")
  await db.close()
})

test("editar: respeta la capacidad, la estadía mínima y que la unidad sea de este complejo y esté activa", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", guests: 2 })
  const before = await snapshot(db, id)
  await who(db, ids, "owner_a")
  const tryUpdate = (unit, from, to, guests, name = "Ana Pérez") =>
    attempt(db, "select update_reservation($1, $2, $3, $4, $5, $6, 'ana@e.test', null, null)", [id, unit, from, to, guests, name])

  assert.match((await tryUpdate(ids.unit_a2, "2027-03-10", "2027-03-12", 3)).error, /OVER_CAPACITY/)
  assert.match((await tryUpdate(ids.unit_a, "2027-03-10", "2027-03-12", 5)).error, /OVER_CAPACITY/)
  assert.match((await tryUpdate(ids.unit_a, "2027-03-10", "2027-03-12", 0)).error, /INVALID_GUESTS/)
  assert.match((await tryUpdate(ids.unit_a, "2027-03-12", "2027-03-12", 2)).error, /INVALID_DATES/)
  assert.match((await tryUpdate(ids.unit_a, "2027-03-13", "2027-03-12", 2)).error, /INVALID_DATES/)
  assert.match((await tryUpdate(ids.unit_a, "2027-03-10", "2027-03-12", 2, "   ")).error, /NAME_REQUIRED/)
  assert.match((await tryUpdate(ids.unit_b, "2027-03-10", "2027-03-12", 2)).error, /UNIT_NOT_FOUND/, "unidad de otro complejo")
  assert.match((await tryUpdate(ids.unit_off, "2027-03-10", "2027-03-12", 2)).error, /UNIT_NOT_FOUND/, "unidad inactiva")
  assert.match((await tryUpdate("00000000-0000-0000-0000-000000000000", "2027-03-10", "2027-03-12", 2)).error, /UNIT_NOT_FOUND/)

  // Estadía mínima de 3 noches desde ahora: mover a 2 noches se rechaza…
  await as(db, "postgres")
  await db.query("update rates set min_nights = 3 where unit_id = $1", [ids.unit_a])
  await who(db, ids, "owner_a")
  assert.match((await tryUpdate(ids.unit_a, "2027-03-20", "2027-03-22", 2)).error, /MIN_NIGHTS:3/)
  // …pero corregir solo el nombre de una reserva que ya existía con 2 noches, no.
  const ok = await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-12", guests: 2, name: "Ana Pérez Gómez", email: "ana@e.test" })
  assert.equal(ok.changed, true)
  assert.deepEqual({ ...(await snapshot(db, id)), guest_id: null }, { ...before, guest_id: null })
  await invariants(db, "validaciones")
  await db.close()
})

test("editar: el total y la seña se recalculan con las mismas tarifas que la reserva nueva", async () => {
  const { db, ids } = await fresh()
  // Para 2 personas, 50% menos (precio según personas, 0040).
  await db.query(
    "insert into unit_guest_prices (unit_id, organization_id, guests, mode, value) values ($1, $2, 2, 'percent', 50)",
    [ids.unit_a, ids.org_a])
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", guests: 3 })
  assert.equal(Number((await snapshot(db, id)).total_amount), 200000)

  await who(db, ids, "owner_a")
  const res = await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-12", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.equal(Number(res.total_amount), 100000)
  assert.equal(Number(res.deposit_amount), 50000)

  // Y es el mismo número que daría cargar esa reserva de cero.
  const fresh2 = await book(db, ids, { from: "2027-08-10", to: "2027-08-12", guests: 2 })
  assert.equal(Number((await snapshot(db, fresh2)).total_amount), Number(res.total_amount))
  await db.close()
})

test("editar: no toca los pagos y avisa el saldo nuevo, también cuando se cobró de más", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", guests: 2 })
  await pay(db, ids, id)
  const payments = () => peek(db, () => rows(db, "select id, amount::text, status from payments where reservation_id = $1 order by id", [id]))
  const before = await payments()

  await who(db, ids, "owner_a")
  // Más noches: queda saldo.
  let res = await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-14", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.deepEqual([Number(res.total_amount), Number(res.paid_amount), Number(res.balance)], [400000, 100000, 300000])
  // Una sola noche: el total baja justo a lo ya cobrado.
  res = await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-11", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.deepEqual([Number(res.total_amount), Number(res.paid_amount), Number(res.balance)], [100000, 100000, 0])
  await peek(db, () => db.query(
    "insert into unit_guest_prices (unit_id, organization_id, guests, mode, value) values ($1, $2, 2, 'percent', 60)",
    [ids.unit_a, ids.org_a]))
  // Con un descuento por personas el total baja por debajo de lo cobrado: saldo negativo (hay plata a devolver).
  res = await update(db, id, { unit: ids.unit_a, from: "2027-03-12", to: "2027-03-13", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.deepEqual([Number(res.total_amount), Number(res.balance)], [40000, -60000])
  assert.deepEqual(await payments(), before, "los pagos quedaron intactos")
  await db.close()
})

test("editar: si no hay tarifa para esas noches, el total queda vacío y se avisa", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  await as(db, "postgres")
  await db.query("delete from rates where unit_id = $1", [ids.unit_a])
  await who(db, ids, "owner_a")
  const res = await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-13", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.equal(res.no_price, true)
  assert.equal(res.total_amount, null)
  assert.equal(res.balance, null)
  await db.close()
})

test("editar: los datos del huésped se corrigen en su ficha; si tiene otras reservas, no se toca su historial", async () => {
  const { db, ids } = await fresh()
  const solo = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", name: "Ana Pérez", email: "ana@e.test", phone: "111" })
  const guestId = (await snapshot(db, solo)).guest_id
  await who(db, ids, "owner_a")
  await update(db, solo, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-12", guests: 2, name: "Ana María Pérez", email: "anamaria@e.test", phone: "222", notes: "Llega tarde" })
  const g = await one(db, "select id, full_name, email, phone from guests where id = $1", [guestId])
  assert.deepEqual(g, { id: guestId, full_name: "Ana María Pérez", email: "anamaria@e.test", phone: "222" })
  assert.equal((await one(db, "select notes from reservations where id = $1", [solo])).notes, "Llega tarde")
  assert.equal((await one(db, "select count(*)::int n from guests")).n, 1, "no quedan fichas de más")

  // Dos reservas de la misma persona: corregir una no renombra a la otra.
  const first = await book(db, ids, { from: "2027-05-01", to: "2027-05-03", name: "Beto Ruiz", email: "beto@e.test" })
  const second = await book(db, ids, { from: "2027-06-01", to: "2027-06-03", name: "Beto Ruiz", email: "beto@e.test" })
  assert.equal((await snapshot(db, first)).guest_id, (await snapshot(db, second)).guest_id)
  await who(db, ids, "owner_a")
  await update(db, first, { unit: ids.unit_a, from: "2027-05-01", to: "2027-05-03", guests: 2, name: "Carla Díaz", email: "carla@e.test" })
  const names = await rows(db,
    "select r.id, g.full_name from reservations r join guests g on g.id = r.guest_id where r.id in ($1, $2)", [first, second])
  assert.equal(names.find((n) => n.id === first).full_name, "Carla Díaz")
  assert.equal(names.find((n) => n.id === second).full_name, "Beto Ruiz")
  await db.close()
})

test("editar: si el mail es de otra ficha, la reserva se vincula a esa y la ficha vieja no queda huérfana", async () => {
  const { db, ids } = await fresh()
  const a = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", name: "Ana Pérez", email: "ana@e.test" })
  const b = await book(db, ids, { from: "2027-04-10", to: "2027-04-12", name: "Beto Ruiz", email: "beto@e.test" })
  const betoGuest = (await snapshot(db, b)).guest_id
  await who(db, ids, "owner_a")
  await update(db, a, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-12", guests: 2, name: "Beto Ruiz", email: "beto@e.test" })
  assert.equal((await snapshot(db, a)).guest_id, betoGuest)
  assert.equal((await one(db, "select count(*)::int n from guests")).n, 1)
  await db.close()
})

test("editar: una consulta (sin fechas retenidas) se edita sin ocupar nada; Completada también se puede corregir", async () => {
  const { db, ids } = await fresh()
  const q = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", status: "inquiry" })
  await who(db, ids, "owner_a")
  await update(db, q, { unit: ids.unit_a, from: "2027-03-15", to: "2027-03-18", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.equal((await snapshot(db, q)).occ, 0)
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-15", "2027-03-18"), true)

  const c = await book(db, ids, { from: "2027-07-10", to: "2027-07-12", name: "Beto", email: "b@e.test" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'completed')", [c])
  const res = await update(db, c, { unit: ids.unit_a, from: "2027-07-11", to: "2027-07-13", guests: 2, name: "Beto", email: "b@e.test" })
  assert.equal(res.changed, true)
  await invariants(db, "consulta y completada")
  await db.close()
})

test("editar: una reserva cancelada o expirada no se edita; sin cambios no se registra nada", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  await who(db, ids, "owner_a")
  const same = await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-12", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  assert.equal(same.changed, false)
  assert.deepEqual(await audit(db, await codeOf(db, id)), [])

  await db.query("select transition_reservation($1, 'cancelled')", [id])
  const e = await attempt(db, "select update_reservation($1, $2, '2027-03-10', '2027-03-12', 2, 'Ana', null, null, null)", [id, ids.unit_a])
  assert.match(e.error, /NOT_EDITABLE/)
  await db.close()
})

test("editar: cualquier miembro edita; nadie de otra organización ni sin sesión", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  const args = [id, ids.unit_a, "2027-03-14", "2027-03-16"]
  const call = () => attempt(db, "select update_reservation($1, $2, $3, $4, 2, 'Ana Pérez', 'ana@e.test', null, null)", args)

  await who(db, ids, "owner_b")
  assert.match((await call()).error, /FORBIDDEN/)
  await as(db, "anon")
  assert.ok((await call()).error, "anon no ejecuta")
  await who(db, ids, "staff_a")
  assert.equal((await call()).error, undefined, "staff edita")
  assert.deepEqual((await snapshot(db, id)).during, "2027-03-14/2027-03-16")
  await invariants(db, "permisos de edición")
  await db.close()
})

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

const del = (db, id) => attempt(db, "select delete_reservation($1) r", [id])

test("eliminar: borra la reserva y todo lo que colgaba de ella, y deja registro", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-13", name: "Prueba Ficticia", email: "prueba@e.test" })
  const code = await codeOf(db, id)
  const guestId = (await snapshot(db, id)).guest_id
  await pay(db, ids, id, { status: "pending" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'completed')", [id]) // deja un aviso al huésped
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-10", "2027-03-13"), false)

  await who(db, ids, "admin_a")
  const r = await del(db, id)
  assert.equal(r.rows[0].r.deleted, true)
  await as(db, "postgres")
  for (const [table, col] of [["reservations", "id"], ["unit_occupancy", "reservation_id"], ["payments", "reservation_id"], ["notification_outbox", "reservation_id"]]) {
    assert.equal((await one(db, `select count(*)::int n from ${table} where ${col} = $1`, [id])).n, 0, table)
  }
  assert.equal((await one(db, "select count(*)::int n from guests where id = $1", [guestId])).n, 0, "no queda el huésped de una reserva borrada")
  assert.equal(await offered(db, ids, ids.unit_a, "2027-03-10", "2027-03-13"), true, "el buscador público la ofrece de nuevo")

  const log = await audit(db, code)
  assert.deepEqual(log.map((l) => l.action), ["deleted"])
  assert.equal(log[0].actor_id, ids.admin_a)
  assert.equal(log[0].detail.guest, "Prueba Ficticia")
  assert.equal(log[0].detail.unit, "Cabaña A")
  assert.equal(log[0].detail.status, "completed")
  assert.equal(log[0].detail.payments_removed, 1)
  await invariants(db, "eliminar")
  await db.close()
})

test("eliminar: solo dueño o administrador de ese complejo", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  for (const key of ["staff_a", "owner_b"]) {
    await who(db, ids, key)
    assert.match((await del(db, id)).error, /FORBIDDEN/, key)
  }
  await as(db, "anon")
  assert.ok((await del(db, id)).error)
  await who(db, ids, "owner_a")
  assert.match((await del(db, "00000000-0000-0000-0000-000000000000")).error, /NOT_FOUND/)
  assert.equal((await one(db, "select count(*)::int n from reservations where id = $1", [id])).n, 1, "no se borró")
  await who(db, ids, "owner_a")
  assert.equal((await del(db, id)).rows[0].r.deleted, true)
  await db.close()
})

test("eliminar: con plata de por medio no se borra, se cancela", async () => {
  const { db, ids } = await fresh()
  const mk = async (from, to, status, extra) => {
    const id = await book(db, ids, { from, to, name: `P ${from}`, email: `${from}@e.test` })
    await pay(db, ids, id, { status, link: extra.link ?? null })
    return id
  }
  const paid = await mk("2027-03-10", "2027-03-12", "paid", {})
  const refunded = await mk("2027-04-10", "2027-04-12", "refunded", {})
  const openLink = await mk("2027-05-10", "2027-05-12", "pending", { link: "https://mp.example/checkout/1" })
  const noLink = await mk("2027-06-10", "2027-06-12", "pending", {})
  const failed = await mk("2027-07-10", "2027-07-12", "failed", {})

  await who(db, ids, "owner_a")
  assert.match((await del(db, paid)).error, /HAS_PAYMENTS/)
  assert.match((await del(db, refunded)).error, /HAS_PAYMENTS/)
  assert.match((await del(db, openLink)).error, /HAS_OPEN_CHECKOUT/)
  assert.equal((await del(db, noLink)).rows[0].r.deleted, true)
  assert.equal((await del(db, failed)).rows[0].r.deleted, true)
  // Las que no se borraron siguen con sus pagos y sus fechas; y se pueden cancelar.
  await as(db, "postgres")
  assert.equal((await one(db, "select count(*)::int n from payments")).n, 3)
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'cancelled')", [paid])
  await invariants(db, "con plata")
  await db.close()
})

test("eliminar: una reserva cancelada, expirada o completada sin pagos también se puede borrar; el huésped con otras reservas se conserva", async () => {
  const { db, ids } = await fresh()
  const a = await book(db, ids, { from: "2027-03-10", to: "2027-03-12", name: "Ana", email: "ana@e.test" })
  const b = await book(db, ids, { from: "2027-04-10", to: "2027-04-12", name: "Ana", email: "ana@e.test" })
  const c = await book(db, ids, { from: "2027-05-10", to: "2027-05-12", name: "Beto", email: "beto@e.test", status: "pending" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'cancelled')", [a])
  await db.query("select transition_reservation($1, 'completed')", [b])
  await as(db, "service_role")
  await db.query("select transition_reservation($1, 'expired')", [c])
  await who(db, ids, "owner_a")
  for (const id of [a, c]) assert.equal((await del(db, id)).rows[0].r.deleted, true)
  assert.equal((await one(db, "select count(*)::int n from guests where email = 'ana@e.test'")).n, 1, "Ana sigue teniendo la reserva completada")
  assert.equal((await one(db, "select count(*)::int n from guests where email = 'beto@e.test'")).n, 0)
  assert.equal((await del(db, b)).rows[0].r.deleted, true)
  await invariants(db, "borrar finales")
  await db.close()
})

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

test("registro: lo ve solo el dueño o un administrador de su complejo", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  const code = await codeOf(db, id)
  await who(db, ids, "staff_a")
  await update(db, id, { unit: ids.unit_a, from: "2027-03-10", to: "2027-03-13", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'cancelled')", [id])
  await db.query("select delete_reservation($1)", [id])

  await who(db, ids, "admin_a")
  const all = await rows(db, "select action, reservation_code, actor_name from reservation_audit_log($1)", [ids.org_a])
  assert.deepEqual(all.map((l) => l.action), ["deleted", "cancelled", "updated"])
  assert.ok(all.every((l) => l.reservation_code === code))
  const only = await rows(db, "select action from reservation_audit_log($1, $2)", [ids.org_a, id])
  assert.equal(only.length, 3)

  await who(db, ids, "staff_a")
  assert.match((await attempt(db, "select * from reservation_audit_log($1)", [ids.org_a])).error, /FORBIDDEN/)
  await who(db, ids, "owner_b")
  assert.match((await attempt(db, "select * from reservation_audit_log($1)", [ids.org_a])).error, /FORBIDDEN/)
  assert.deepEqual((await rows(db, "select * from reservation_audit_log($1)", [ids.org_b])), [], "el otro complejo no ve lo de este")
  await as(db, "anon")
  assert.ok((await attempt(db, "select * from reservation_audit_log($1)", [ids.org_a])).error)
  assert.ok((await attempt(db, "select * from app_private.reservation_audit")).error, "la tabla no se lee directo")
  await db.close()
})

// ---------------------------------------------------------------------------
// Ingreso y salida
// ---------------------------------------------------------------------------

test("ingreso y salida: el update directo no guardaba nada; la función sí", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  await who(db, ids, "owner_a")
  // Cómo lo hacía el panel antes: parecía guardar y la política de solo lectura lo descartaba.
  const direct = await attempt(db, "update reservations set checked_in_at = now() where id = $1 returning id", [id])
  assert.deepEqual(direct.rows, [], "0 filas actualizadas, sin error")
  assert.equal((await one(db, "select checked_in_at from reservations where id = $1", [id])).checked_in_at, null)

  const at = await one(db, "select record_reservation_movement($1, 'checkin') r", [id])
  assert.ok(at.r)
  assert.ok((await one(db, "select checked_in_at from reservations where id = $1", [id])).checked_in_at)
  assert.match((await attempt(db, "select record_reservation_movement($1, 'checkin')", [id])).error, /ALREADY_RECORDED/)
  await db.query("select record_reservation_movement($1, 'checkout')", [id])
  assert.match((await attempt(db, "select record_reservation_movement($1, 'otro')", [id])).error, /INVALID_MOVEMENT/)

  await who(db, ids, "owner_b")
  assert.match((await attempt(db, "select record_reservation_movement($1, 'checkout')", [id])).error, /FORBIDDEN/)
  await who(db, ids, "owner_a")
  await db.query("select transition_reservation($1, 'cancelled')", [id])
  const id2 = await book(db, ids, { from: "2027-04-10", to: "2027-04-12" })
  await db.query("select transition_reservation($1, 'cancelled')", [id2])
  assert.match((await attempt(db, "select record_reservation_movement($1, 'checkin')", [id2])).error, /NOT_EDITABLE/)
  await db.close()
})

// ---------------------------------------------------------------------------
// Convivencia con la sincronización de calendarios
// ---------------------------------------------------------------------------

const sync = (db, ids, ranges) =>
  one(db, "select sync_unit_external_blocks($1, $2, 'booking', $3::jsonb, false) r", [ids.ical_token, ids.unit_a, JSON.stringify(ranges)]).then((x) => x.r)

test("iCal: una reserva movida libera sus fechas viejas para Booking y defiende las nuevas", async () => {
  const { db, ids } = await fresh()
  const id = await book(db, ids, { from: "2027-03-10", to: "2027-03-13" })
  await who(db, ids, "owner_a")
  await update(db, id, { unit: ids.unit_a, from: "2027-03-20", to: "2027-03-23", guests: 2, name: "Ana Pérez", email: "ana@e.test" })
  await as(db, "postgres")

  // Booking cierra las fechas viejas: ahora están libres, se importan sin problema.
  const onOld = await sync(db, ids, [{ uid: "old@b", start_date: "2027-03-10", end_date: "2027-03-13" }])
  assert.equal(onOld.inserted, 1)
  assert.equal(onOld.collisions, 0)
  // Booking cierra las fechas nuevas: ya son de la reserva; queda anotado como posible sobreventa y la reserva no se toca.
  const onNew = await sync(db, ids, [
    { uid: "old@b", start_date: "2027-03-10", end_date: "2027-03-13" },
    { uid: "new@b", start_date: "2027-03-21", end_date: "2027-03-22" }])
  assert.equal(onNew.collisions, 1)
  const s = await snapshot(db, id)
  assert.deepEqual([s.occ, s.during], [1, "2027-03-20/2027-03-23"])
  await invariants(db, "iCal")

  // Y mover la reserva sobre una fecha ya importada se rechaza.
  await who(db, ids, "owner_a")
  const e = await attempt(db, "select update_reservation($1, $2, '2027-03-11', '2027-03-14', 2, 'Ana Pérez', 'ana@e.test', null, null)", [id, ids.unit_a])
  assert.match(e.error, /UNAVAILABLE/)
  await db.close()
})

// ---------------------------------------------------------------------------
// Consistencia: mezcla de operaciones, y después de CADA una el calendario cuadra
// ---------------------------------------------------------------------------

test("consistencia: 120 operaciones mezcladas dejan siempre el calendario sin pisarse y sin huérfanos", async () => {
  const { db, ids } = await fresh()
  let seedN = 7
  const rnd = (n) => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN % n }
  const units = [ids.unit_a, ids.unit_a2]
  const day = (n) => new Date(Date.UTC(2027, 8, 1 + n)).toISOString().slice(0, 10)
  const live = []
  let created = 0
  const stats = { ok: 0, rejected: 0 }

  for (let step = 0; step < 120; step++) {
    const op = rnd(10)
    try {
      await who(db, ids, rnd(4) === 0 ? "staff_a" : "owner_a")
      if (op < 3 || live.length < 2) {
        const from = rnd(25), len = 1 + rnd(4)
        const unit = units[rnd(2)]
        const { rows: [r] } = await db.query(
          "select id from create_manual_reservation($1, $2, $3, $4, $5, null, $6, $7, $8, $9, null)",
          [ids.org_a, ids.prop_a, unit, `Huésped ${created}`, `h${created++ % 5}@e.test`, day(from), day(from + len), 1 + rnd(2), ["confirmed", "pending", "inquiry"][rnd(3)]])
        live.push(r.id); stats.ok++
      } else if (op < 7) {
        const id = live[rnd(live.length)]
        const from = rnd(25), len = 1 + rnd(4)
        await update(db, id, { unit: units[rnd(2)], from: day(from), to: day(from + len), guests: 1 + rnd(2), name: `Editado ${rnd(3)}`, email: `e${rnd(4)}@e.test` })
        stats.ok++
      } else if (op < 9) {
        const id = live[rnd(live.length)]
        const to = ["confirmed", "completed", "cancelled", "pending", "pending_payment"][rnd(5)]
        await db.query("select transition_reservation($1, $2, $3)", [id, to, rnd(2) === 0])
        stats.ok++
      } else {
        const id = live.splice(rnd(live.length), 1)[0]
        await who(db, ids, "owner_a")
        await db.query("select delete_reservation($1)", [id])
        stats.ok++
      }
    } catch (error) {
      // Rechazos esperados: fechas ocupadas, transición inválida, edición de una cancelada, permisos de staff.
      assert.match(String(error.message), /UNAVAILABLE|INVALID_TRANSITION|NOT_EDITABLE|FORBIDDEN|OVER_CAPACITY/, `paso ${step}: ${error.message}`)
      stats.rejected++
    }
    await invariants(db, `paso ${step} (op ${op})`)
  }
  assert.ok(stats.ok > 40 && stats.rejected > 5, JSON.stringify(stats))
  await db.close()
})

test("consistencia: la restricción de fechas también cubre el update directo de una ocupación", async () => {
  const { db, ids } = await fresh()
  await book(db, ids, { from: "2027-03-10", to: "2027-03-12" })
  const other = await book(db, ids, { from: "2027-03-20", to: "2027-03-22", name: "Otro", email: "o@e.test" })
  await as(db, "postgres")
  const e = await attempt(db, "update unit_occupancy set during = '[2027-03-11,2027-03-13)' where reservation_id = $1", [other])
  assert.match(e.error, /conflicting key value violates exclusion constraint/)
  await invariants(db, "restricción")
  await db.close()
})
