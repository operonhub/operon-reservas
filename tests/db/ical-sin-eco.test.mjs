/**
 * Migración 0042: el link de calendario no le devuelve a cada plataforma lo
 * que se importó de ella. Era el eco que hacía que Booking dejara de publicar
 * sus propias reservas (Cabañas 4 Elementos, 2026-10-06).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDb, as } from "./harness.mjs"
import { seed } from "./seed.mjs"

const rows = async (db, sql, params) => (await db.query(sql, params)).rows
const one = async (db, sql, params) => (await rows(db, sql, params))[0]

async function fresh() {
  const db = await createDb()
  const ids = await seed(db)
  const { ical_token: token } = await one(db, "select ical_token from units where id = $1", [ids.unit_a])
  const { worker_token: worker } = await one(db, "select worker_token from app_private.ical_sync_worker_config")
  return { db, ids, token, worker }
}

const sync = (db, worker, unit, source, ranges) =>
  one(db, "select sync_unit_external_blocks($1, $2, $3, $4::jsonb, $5) r",
    [worker, unit, source, JSON.stringify(ranges), ranges.length === 0])

async function feed(db, unit, token, canal) {
  await as(db, "anon")
  const { f } = canal === undefined
    ? await one(db, "select public_ical_feed($1, $2) f", [unit, token])
    : await one(db, "select public_ical_feed($1, $2, $3) f", [unit, token, canal])
  await as(db, "postgres")
  return f.ranges.map((r) => `${r.start_date}→${r.end_date}`)
}

async function withEverything() {
  const ctx = await fresh()
  const { db, ids, worker } = ctx
  // Un bloqueo cargado a mano en el panel, una reserva importada de Booking y otra de Airbnb.
  await db.query(
    "insert into unit_occupancy (organization_id, unit_id, during, kind, block_reason) values ($1, $2, '[2027-03-01,2027-03-05)', 'block', 'Mantenimiento')",
    [ids.org_a, ids.unit_a])
  await sync(db, worker, ids.unit_a, "booking", [{ uid: "b1@booking.com", start_date: "2027-04-10", end_date: "2027-04-14" }])
  await sync(db, worker, ids.unit_a, "airbnb", [{ uid: "a1@airbnb.com", start_date: "2027-05-20", end_date: "2027-05-23" }])
  return ctx
}

const MANUAL = "2027-03-01→2027-03-05"
const DE_BOOKING = "2027-04-10→2027-04-14"
const DE_AIRBNB = "2027-05-20→2027-05-23"

test("el link de siempre (sin canal) solo lleva lo cargado en Operon, nada importado", async () => {
  const { db, ids, token } = await withEverything()
  assert.deepEqual(await feed(db, ids.unit_a, token), [MANUAL])
  // Un canal desconocido o vacío se comporta como el link de siempre: nunca abre la puerta al eco.
  assert.deepEqual(await feed(db, ids.unit_a, token, "google"), [MANUAL])
  assert.deepEqual(await feed(db, ids.unit_a, token, ""), [MANUAL])
  assert.deepEqual(await feed(db, ids.unit_a, token, null), [MANUAL])
  await db.close()
})

test("a Booking no le vuelven sus fechas, pero sí le llegan las de Airbnb (y al revés)", async () => {
  const { db, ids, token } = await withEverything()
  assert.deepEqual(await feed(db, ids.unit_a, token, "booking"), [MANUAL, DE_AIRBNB])
  assert.deepEqual(await feed(db, ids.unit_a, token, "airbnb"), [MANUAL, DE_BOOKING])
  assert.deepEqual(await feed(db, ids.unit_a, token, "BOOKING"), [MANUAL, DE_AIRBNB])
  await db.close()
})

test("una reserva hecha en Operon sale por todos los links", async () => {
  const { db, ids, token } = await withEverything()
  await as(db, "anon")
  await one(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-06-01', '2027-06-04', 2, 'Ana Prueba', 'ana@test.com', null, null) r",
    [ids.unit_a])
  await as(db, "postgres")
  const propia = "2027-06-01→2027-06-04"
  assert.ok((await feed(db, ids.unit_a, token)).includes(propia))
  assert.ok((await feed(db, ids.unit_a, token, "booking")).includes(propia))
  assert.ok((await feed(db, ids.unit_a, token, "airbnb")).includes(propia))
  await db.close()
})

test("el token sigue siendo obligatorio con o sin canal", async () => {
  const { db, ids } = await withEverything()
  await as(db, "anon")
  assert.deepEqual((await one(db, "select public_ical_feed($1, $2, 'booking') f", [ids.unit_a, "0".repeat(36)])).f, { found: false })
  assert.deepEqual((await one(db, "select public_ical_feed($1, null, 'booking') f", [ids.unit_a])).f, { found: false })
  await db.close()
})

/**
 * El ciclo completo, simulando a Booking como se comprobó que se comporta:
 * importa nuestro link y deja de publicar en su feed las fechas que le
 * llegaron por ahí. Con el link viejo el calendario oscilaba; con el nuevo
 * queda quieto y completo.
 */
test("simulación del eco: con el link nuevo el calendario de Booking no oscila", async () => {
  const { db, ids, token, worker } = await fresh()
  const NATIVAS = [
    { uid: "r1@booking.com", start_date: "2027-01-10", end_date: "2027-01-14" },
    { uid: "r2@booking.com", start_date: "2027-02-01", end_date: "2027-02-08" },
    { uid: "r3@booking.com", start_date: "2027-03-20", end_date: "2027-03-22" },
  ]
  const key = (r) => `${r.start_date}→${r.end_date}`
  let importadoPorBooking = [] // lo último que Booking leyó de nuestro link

  for (let vuelta = 0; vuelta < 8; vuelta++) {
    // Booking publica sus reservas menos las fechas que le llegaron de Operon.
    const feedBooking = NATIVAS.filter((r) => !importadoPorBooking.includes(key(r)))
    assert.equal(feedBooking.length, NATIVAS.length, `vuelta ${vuelta}: Booking publica todas sus reservas`)
    await sync(db, worker, ids.unit_a, "booking", feedBooking)
    // Booking vuelve a importar nuestro link (el genérico, el que ya tienen pegado).
    importadoPorBooking = await feed(db, ids.unit_a, token)
    assert.deepEqual(importadoPorBooking, [], `vuelta ${vuelta}: a Booking no le vuelve nada suyo`)
    const { n } = await one(db,
      "select count(*)::int n from unit_occupancy where unit_id = $1 and external_source = 'booking' and missing_count = 0",
      [ids.unit_a])
    assert.equal(n, NATIVAS.length, `vuelta ${vuelta}: las tres siguen bloqueadas y sin faltas`)
  }
  await db.close()
})

test("contraprueba: si a Booking le vuelven sus fechas, las deja de publicar y el calendario oscila", async () => {
  const { db, ids, token, worker } = await fresh()
  const NATIVAS = [
    { uid: "r1@booking.com", start_date: "2027-01-10", end_date: "2027-01-14" },
    { uid: "r2@booking.com", start_date: "2027-02-01", end_date: "2027-02-08" },
  ]
  const key = (r) => `${r.start_date}→${r.end_date}`
  // El link "para Airbnb" incluye lo importado de Booking: pegarlo en Booking
  // reproduce el export anterior a 0042.
  const linkConEco = () => feed(db, ids.unit_a, token, "airbnb")

  await sync(db, worker, ids.unit_a, "booking", NATIVAS)
  const importado = await linkConEco()
  assert.deepEqual(importado, NATIVAS.map(key))
  // Booking deja de publicar lo que le llegó por el link: su feed queda vacío…
  const feedBooking = NATIVAS.filter((r) => !importado.includes(key(r)))
  assert.deepEqual(feedBooking, [])
  // …y Operon las ve "faltar" aunque las dos reservas siguen vigentes.
  const { r } = await sync(db, worker, ids.unit_a, "booking", feedBooking)
  assert.equal(r.pending_removal, 2)
  assert.equal(r.mass_drop, true)
  assert.equal(r.removed, 0)
  await db.close()
})
