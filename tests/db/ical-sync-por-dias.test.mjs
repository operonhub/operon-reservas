/**
 * Migración 0043: el sync de calendarios por días. Bloquear es inmediato,
 * liberar es con margen. Contra el esquema real en PGlite.
 *
 * Booking exporta tramos de días cerrados y el uid es un hash de las fechas:
 * cuando un tramo cambia de forma cambia de uid. Los casos de acá son los que
 * la comparación evento-por-evento de 0041 dejaba sin bloquear.
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
  ids.admin = (await one(db, "insert into auth.users (email) values ('santiago@operonhub.test') returning id")).id
  await db.query("insert into platform_admins (user_id) values ($1)", [ids.admin])
  return { db, ids }
}

const ev = (uid, start_date, end_date) => ({ uid, start_date, end_date })

async function sync(db, ids, ranges, { source = "booking", unit = ids.unit_a, allowEmpty } = {}) {
  const { r } = await one(db, "select sync_unit_external_blocks($1, $2, $3, $4::jsonb, $5) r",
    [ids.ical_token, unit, source, JSON.stringify(ranges), allowEmpty ?? ranges.length === 0])
  return r
}

/** Bloques importados de la unidad, ordenados: "uid [desde,hasta) faltas". */
async function blocks(db, ids, source = "booking") {
  return (await rows(db,
    `select external_uid uid, lower(during)::text d, upper(during)::text h, missing_count mc, id
       from unit_occupancy where unit_id = $1 and external_source = $2 order by lower(during)`,
    [ids.unit_a, source])).map((b) => `${b.uid} ${b.d}→${b.h} ${b.mc}`)
}

/** Días bloqueados por lo importado, como texto de multirango. */
const covered = async (db, ids) =>
  (await one(db, "select coalesce(range_agg(during), '{}')::text m from unit_occupancy where unit_id = $1 and external_source = 'booking'", [ids.unit_a])).m

/** ¿Se puede reservar por la web esas fechas? */
async function canBook(db, ids, from, to) {
  await as(db, "anon")
  const res = await attempt(db,
    "select create_public_reservation('alto-cielo', null, $1, $2, $3, 2, 'Prueba', 'p@e.test', null, null) r", [ids.unit_a, from, to])
  await as(db, "postgres")
  if (res.error) return false
  // No dejar la reserva de prueba ocupando la fecha.
  await db.query("delete from reservations where unit_id = $1 and check_in = $2", [ids.unit_a, from])
  return true
}

/** Hace de cuenta que pasó el tiempo: atrasa "desde cuándo falta". */
const age = (db, ids, interval) =>
  db.query("update unit_occupancy set missing_since = missing_since - $2::interval where unit_id = $1 and missing_since is not null",
    [ids.unit_a, interval])

const history = async (db) =>
  (await rows(db, "select action, lower(during)::text d, upper(during)::text h from app_private.ical_sync_history order by id"))
    .map((x) => `${x.action} ${x.d}→${x.h}`)

// ---------------------------------------------------------------------------

test("una corrida sin cambios no toca nada: mismas filas, mismo id", async () => {
  const { db, ids } = await fresh()
  const feed = [ev("a@b", "2027-01-10", "2027-01-14"), ev("c@b", "2027-02-01", "2027-02-08")]
  const first = await sync(db, ids, feed)
  assert.equal(first.inserted, 2)
  const before = await rows(db, "select id from unit_occupancy where unit_id = $1 order by id", [ids.unit_a])
  const again = await sync(db, ids, feed)
  assert.deepEqual([again.inserted, again.updated, again.removed, again.pending_removal], [0, 0, 0, 0])
  assert.deepEqual(await rows(db, "select id from unit_occupancy where unit_id = $1 order by id", [ids.unit_a]), before)
  await db.close()
})

test("cancelación: la fecha sigue bloqueada hasta que falte 3 corridas Y 3 horas", async () => {
  const { db, ids } = await fresh()
  const A = ev("a@b", "2027-01-10", "2027-01-14"), B = ev("c@b", "2027-02-01", "2027-02-08"), C = ev("d@b", "2027-03-01", "2027-03-05")
  await sync(db, ids, [A, B, C])

  // Tres sincronizaciones seguidas (una forzada tras otra) no alcanzan: no pasó el tiempo.
  for (let i = 1; i <= 4; i++) {
    const r = await sync(db, ids, [A, C])
    assert.deepEqual([r.removed, r.pending_removal, r.mass_drop], [0, 1, false], `corrida ${i}`)
    assert.equal(await canBook(db, ids, "2027-02-02", "2027-02-05"), false, `corrida ${i}: sigue bloqueada`)
  }
  // Pasaron las 3 horas: ahora sí se libera.
  await age(db, ids, "3 hours 5 minutes")
  const r = await sync(db, ids, [A, C])
  assert.deepEqual([r.removed, r.pending_removal], [1, 0])
  assert.equal(await canBook(db, ids, "2027-02-02", "2027-02-05"), true)
  assert.deepEqual(await history(db), ["missing_started 2027-02-01→2027-02-08", "removed 2027-02-01→2027-02-08"])
  await db.close()
})

test("con tiempo de sobra pero una sola corrida, tampoco se libera", async () => {
  const { db, ids } = await fresh()
  const A = ev("a@b", "2027-01-10", "2027-01-14"), B = ev("c@b", "2027-02-01", "2027-02-08"), C = ev("d@b", "2027-03-01", "2027-03-05")
  await sync(db, ids, [A, B, C])
  await sync(db, ids, [A, C])
  await age(db, ids, "10 hours")
  const r = await sync(db, ids, [A, C]) // segunda corrida en falta
  assert.deepEqual([r.removed, r.pending_removal], [0, 1])
  await db.close()
})

test("si la reserva reaparece, el contador vuelve a cero", async () => {
  const { db, ids } = await fresh()
  const A = ev("a@b", "2027-01-10", "2027-01-14"), B = ev("c@b", "2027-02-01", "2027-02-08"), C = ev("d@b", "2027-03-01", "2027-03-05")
  await sync(db, ids, [A, B, C])
  await sync(db, ids, [A, C]); await sync(db, ids, [A, C])
  await age(db, ids, "5 hours")
  const back = await sync(db, ids, [A, B, C])
  assert.deepEqual([back.removed, back.pending_removal], [0, 0])
  assert.deepEqual(await blocks(db, ids), ["a@b 2027-01-10→2027-01-14 0", "c@b 2027-02-01→2027-02-08 0", "d@b 2027-03-01→2027-03-05 0"])
  // Vuelve a faltar: arranca de nuevo, no hereda las faltas viejas.
  const r = await sync(db, ids, [A, C])
  assert.deepEqual([r.removed, r.pending_removal], [0, 1])
  assert.deepEqual(await history(db), [
    "missing_started 2027-02-01→2027-02-08", "recovered 2027-02-01→2027-02-08", "missing_started 2027-02-01→2027-02-08"])
  await db.close()
})

test("el cierre de temporada se estira un día (uid nuevo): queda todo cubierto en la misma corrida", async () => {
  const { db, ids } = await fresh()
  const R = ev("r@b", "2027-01-10", "2027-01-14")
  await sync(db, ids, [R, ev("h1@b", "2027-07-01", "2028-04-03")])
  const r = await sync(db, ids, [R, ev("h2@b", "2027-07-01", "2028-04-04")])
  assert.deepEqual([r.pending_removal, r.mass_drop, r.removed], [0, false, 0])
  assert.deepEqual(await blocks(db, ids), ["r@b 2027-01-10→2027-01-14 0", "h2@b 2027-07-01→2028-04-04 0"])
  assert.deepEqual(await history(db), [], "que un tramo cambie de forma no es una falta")
  await db.close()
})

test("reserva nueva pegada a otra (Booking funde los tramos): los días nuevos se bloquean ya", async () => {
  const { db, ids } = await fresh()
  await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-12")])
  assert.equal(await canBook(db, ids, "2027-01-12", "2027-01-15"), true)
  const r = await sync(db, ids, [ev("ab@b", "2027-01-10", "2027-01-15")])
  assert.equal(r.inserted, 1)
  assert.equal(await canBook(db, ids, "2027-01-12", "2027-01-15"), false, "los días de la reserva nueva quedan bloqueados en la misma corrida")
  assert.deepEqual(await blocks(db, ids), ["ab@b 2027-01-10→2027-01-15 0"])
  await db.close()
})

test("reserva nueva que llena el hueco entre dos (mismo uid, tramo más largo): bloqueada en la misma corrida", async () => {
  const { db, ids } = await fresh()
  // Así se vio en el feed real: cuando un tramo crece, Booking conserva el uid del que empieza antes.
  await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-12"), ev("c@b", "2027-01-14", "2027-01-16"), ev("z@b", "2027-05-01", "2027-05-04")])
  assert.equal(await canBook(db, ids, "2027-01-12", "2027-01-14"), true)
  const r = await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-16"), ev("z@b", "2027-05-01", "2027-05-04")])
  assert.deepEqual([r.updated, r.pending_removal, r.removed], [1, 0, 0])
  assert.equal(await canBook(db, ids, "2027-01-12", "2027-01-14"), false, "el hueco quedó vendido en Booking: bloqueado ya")
  assert.deepEqual(await blocks(db, ids), ["a@b 2027-01-10→2027-01-16 0", "z@b 2027-05-01→2027-05-04 0"])
  assert.deepEqual(await history(db), [])
  await db.close()
})

test("un tramo que se achica: lo que sigue se actualiza ya y lo que sobra espera el margen", async () => {
  const { db, ids } = await fresh()
  const X = ev("x@b", "2027-05-01", "2027-05-03"), Y = ev("y@b", "2027-06-01", "2027-06-03")
  await sync(db, ids, [X, Y, ev("big@b", "2027-01-10", "2027-01-20")])
  // Se canceló la estadía del medio: quedan dos tramos y un hueco.
  const feed = [X, Y, ev("l@b", "2027-01-10", "2027-01-13"), ev("r@b", "2027-01-16", "2027-01-20")]
  const r = await sync(db, ids, feed)
  assert.deepEqual([r.pending_removal, r.removed, r.mass_drop], [1, 0, false])
  assert.deepEqual((await blocks(db, ids)).slice(0, 3), [
    "l@b 2027-01-10→2027-01-13 0", "big@b~20270113 2027-01-13→2027-01-16 1", "r@b 2027-01-16→2027-01-20 0"])
  assert.equal(await canBook(db, ids, "2027-01-13", "2027-01-16"), false, "el hueco sigue bloqueado mientras dura el margen")

  await sync(db, ids, feed); await age(db, ids, "4 hours")
  const done = await sync(db, ids, feed)
  assert.equal(done.removed, 1)
  assert.equal(await canBook(db, ids, "2027-01-13", "2027-01-16"), true)
  await db.close()
})

test("el evento pisa un bloqueo manual: se bloquea lo que sobra a los costados, sin alarma", async () => {
  const { db, ids } = await fresh()
  const manual = await one(db,
    "insert into unit_occupancy (organization_id, unit_id, during, kind, block_reason) values ($1, $2, '[2027-01-12,2027-01-13)', 'block', 'Pintura') returning id",
    [ids.org_a, ids.unit_a])
  const feed = [ev("a@b", "2027-01-10", "2027-01-15")]
  const r = await sync(db, ids, feed)
  assert.deepEqual([r.skipped_conflicts, r.collisions], [1, 0])
  assert.deepEqual(await blocks(db, ids), ["a@b 2027-01-10→2027-01-12 0", "a@b#2 2027-01-13→2027-01-15 0"])
  assert.equal(await canBook(db, ids, "2027-01-13", "2027-01-15"), false)

  // Estable: otra corrida no cambia nada.
  const again = await sync(db, ids, feed)
  assert.deepEqual([again.inserted, again.updated, again.removed, again.pending_removal], [0, 0, 0, 0])

  // El dueño borra su bloqueo: en la corrida siguiente el evento ocupa todo, sin hueco.
  await db.query("delete from unit_occupancy where id = $1", [manual.id])
  await sync(db, ids, feed)
  assert.deepEqual(await blocks(db, ids), ["a@b 2027-01-10→2027-01-15 0"])
  await db.close()
})

test("la plataforma vende días que en Operon ya tenían reserva: queda anotado como posible sobreventa", async () => {
  const { db, ids } = await fresh()
  await as(db, "anon")
  const { r: res } = await one(db,
    "select create_public_reservation('alto-cielo', null, $1, '2027-03-10', '2027-03-13', 2, 'Ana', 'ana@e.test', null, null) r", [ids.unit_a])
  await as(db, "postgres")

  const feed = [ev("z@b", "2027-03-08", "2027-03-12")]
  const r = await sync(db, ids, feed)
  assert.deepEqual([r.collisions, r.skipped_conflicts], [1, 1])
  // Lo que no pisa la reserva queda bloqueado igual.
  assert.deepEqual(await blocks(db, ids), ["z@b 2027-03-08→2027-03-10 0"])

  await as(db, "authenticated", { uid: ids.admin })
  const [c] = await rows(db, "select * from operon_ical_attention($1) where kind = 'conflict'", [ids.org_a])
  await as(db, "postgres")
  assert.equal(c.unit_name, "Cabaña A")
  assert.equal(c.source, "booking")
  assert.equal(c.other_kind, "reservation")
  assert.equal(c.reservation_code, res.code)

  // Se repite en cada corrida sin duplicarse…
  await sync(db, ids, feed)
  assert.equal((await one(db, "select count(*)::int n from app_private.ical_sync_conflicts")).n, 1)
  // …y se da por resuelto cuando la plataforma deja de traerlo.
  await sync(db, ids, [ev("otra@b", "2027-09-01", "2027-09-03")])
  assert.equal((await one(db, "select count(*)::int n from app_private.ical_sync_conflicts where resolved_at is null")).n, 0)
  await db.close()
})

test("una reserva cargada en Operon como venida de Booking no es un choque", async () => {
  const { db, ids } = await fresh()
  await as(db, "anon")
  await one(db, "select create_public_reservation('alto-cielo', null, $1, '2027-03-10', '2027-03-13', 2, 'Ana', 'ana@e.test', null, null) r", [ids.unit_a])
  await as(db, "postgres")
  await db.query("update reservations set source = 'booking' where unit_id = $1", [ids.unit_a])
  const r = await sync(db, ids, [ev("z@b", "2027-03-10", "2027-03-13")])
  assert.deepEqual([r.collisions, r.skipped_conflicts], [0, 1])
  await db.close()
})

test("desaparecen varias juntas (feed roto): 24 corridas y 24 horas antes de liberar", async () => {
  const { db, ids } = await fresh()
  const all = [ev("a@b", "2027-01-10", "2027-01-14"), ev("b@b", "2027-02-01", "2027-02-08"),
    ev("c@b", "2027-03-01", "2027-03-05"), ev("d@b", "2027-04-01", "2027-04-04")]
  await sync(db, ids, all)
  const only = [all[0]]
  let r = await sync(db, ids, only)
  assert.deepEqual([r.mass_drop, r.pending_removal, r.removed], [true, 3, 0])

  // Con el margen de una cancelación normal cumplido de sobra, siguen bloqueando.
  await sync(db, ids, only); await sync(db, ids, only)
  await age(db, ids, "6 hours")
  r = await sync(db, ids, only)
  assert.deepEqual([r.mass_drop, r.pending_removal, r.removed], [true, 3, 0])
  assert.equal(await canBook(db, ids, "2027-02-02", "2027-02-05"), false)

  // 24 corridas y más de 24 horas: recién ahí.
  await db.query("update unit_occupancy set missing_count = 23 where unit_id = $1 and missing_count > 0", [ids.unit_a])
  await age(db, ids, "20 hours")
  r = await sync(db, ids, only)
  assert.deepEqual([r.removed, r.pending_removal], [3, 0])
  await db.close()
})

test("calendario vacío: sin confirmación no se toca nada; confirmado, espera el margen", async () => {
  const { db, ids } = await fresh()
  await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-14"), ev("b@b", "2027-02-01", "2027-02-08")])
  const ignored = await sync(db, ids, [], { allowEmpty: false })
  assert.equal(ignored.empty_feed_ignored, true)
  assert.deepEqual(await blocks(db, ids), ["a@b 2027-01-10→2027-01-14 0", "b@b 2027-02-01→2027-02-08 0"])

  const empty = await sync(db, ids, [], { allowEmpty: true })
  assert.deepEqual([empty.mass_drop, empty.pending_removal, empty.removed], [true, 2, 0])
  assert.equal(await canBook(db, ids, "2027-01-10", "2027-01-12"), false)
  await db.close()
})

test("un bloque en espera (hold_until) no se libera solo, y el feed lo reemplaza cuando trae esos días", async () => {
  const { db, ids } = await fresh()
  const A = ev("a@b", "2027-01-10", "2027-01-14"), B = ev("b@b", "2027-02-01", "2027-02-08"), C = ev("c@b", "2027-03-01", "2027-03-05")
  await sync(db, ids, [A, B, C])
  // Una reserva que alguien restauró a mano mientras el feed no la traía.
  await db.query(
    `insert into unit_occupancy (organization_id, unit_id, during, kind, external_source, external_uid, hold_until)
     values ($1, $2, '[2027-11-20,2027-11-23)', 'block', 'booking', 'restaurado~20271120', now() + interval '30 days')`,
    [ids.org_a, ids.unit_a])

  for (let i = 0; i < 4; i++) await sync(db, ids, [A, B, C])
  await age(db, ids, "40 hours")
  const r = await sync(db, ids, [A, B, C])
  assert.deepEqual([r.removed, r.pending_removal], [0, 1], "pasó el margen pero está en espera")
  assert.equal(await canBook(db, ids, "2027-11-20", "2027-11-23"), false)

  // Booking empieza a publicarla (con su propio uid, y un día más larga).
  const done = await sync(db, ids, [A, B, C, ev("real@b", "2027-11-20", "2027-11-24")])
  assert.equal(done.pending_removal, 0)
  const last = (await blocks(db, ids)).at(-1)
  assert.equal(last, "real@b 2027-11-20→2027-11-24 0")
  assert.equal((await one(db, "select count(*)::int n from unit_occupancy where unit_id = $1 and hold_until is not null", [ids.unit_a])).n, 0)

  // Vencida la espera, un bloque en espera se comporta como cualquier otro.
  await db.query(
    `insert into unit_occupancy (organization_id, unit_id, during, kind, external_source, external_uid, hold_until, missing_count, missing_since)
     values ($1, $2, '[2027-12-01,2027-12-03)', 'block', 'booking', 'restaurado~20271201', now() - interval '1 minute', 5, now() - interval '9 hours')`,
    [ids.org_a, ids.unit_a])
  const expired = await sync(db, ids, [A, B, C, ev("real@b", "2027-11-20", "2027-11-24")])
  assert.equal(expired.removed, 1)
  await db.close()
})

test("estadías terminadas se limpian al instante; una en curso que falta sigue bloqueando desde hoy", async () => {
  const { db, ids } = await fresh()
  const A = ev("a@b", "2027-01-10", "2027-01-14"), B = ev("b@b", "2027-02-01", "2027-02-08"), C = ev("c@b", "2027-03-01", "2027-03-05")
  await sync(db, ids, [A, B, C])
  await db.query(
    `insert into unit_occupancy (organization_id, unit_id, during, kind, external_source, external_uid) values
       ($1, $2, daterange(current_date - 10, current_date - 6, '[)'), 'block', 'booking', 'vieja@b'),
       ($1, $2, daterange(current_date - 2, current_date + 3, '[)'), 'block', 'booking', 'encurso@b')`,
    [ids.org_a, ids.unit_a])
  const r = await sync(db, ids, [A, B, C])
  assert.deepEqual([r.removed, r.pending_removal, r.mass_drop], [1, 1, false])
  const { d, h } = await one(db,
    "select (lower(during) - current_date) d, (upper(during) - current_date) h from unit_occupancy where unit_id = $1 and missing_count > 0", [ids.unit_a])
  assert.deepEqual([d, h], [0, 3], "queda bloqueado desde hoy hasta el final de la estadía")
  assert.equal((await one(db, "select count(*)::int n from unit_occupancy where external_uid = 'vieja@b'")).n, 0)
  await db.close()
})

test("el mismo uid con otras fechas (Airbnb cambia la reserva): las nuevas ya, las viejas con margen", async () => {
  const { db, ids } = await fresh()
  const A = ev("a@air", "2027-01-10", "2027-01-14"), B = ev("b@air", "2027-02-01", "2027-02-08")
  await sync(db, ids, [A, B, ev("m@air", "2027-03-01", "2027-03-05")], { source: "airbnb" })
  const r = await sync(db, ids, [A, B, ev("m@air", "2027-03-10", "2027-03-15")], { source: "airbnb" })
  assert.deepEqual([r.updated, r.inserted, r.pending_removal], [1, 0, 1])
  assert.deepEqual((await blocks(db, ids, "airbnb")).slice(2), ["m@air~20270301 2027-03-01→2027-03-05 1", "m@air 2027-03-10→2027-03-15 0"])
  await db.close()
})

test("dos eventos del feed que se pisan entre sí no rompen nada", async () => {
  const { db, ids } = await fresh()
  const r = await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-15"), ev("b@b", "2027-01-13", "2027-01-18")])
  assert.equal(r.inserted, 2)
  assert.equal(await covered(db, ids), "{[2027-01-10,2027-01-18)}")
  await db.close()
})

test("Booking y Airbnb no se pisan los bloques: cada plataforma maneja los suyos", async () => {
  const { db, ids } = await fresh()
  await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-14")])
  await sync(db, ids, [ev("x@air", "2027-02-01", "2027-02-05")], { source: "airbnb" })
  // Airbnb vacío y confirmado no toca lo de Booking.
  await sync(db, ids, [], { source: "airbnb", allowEmpty: true })
  assert.deepEqual(await blocks(db, ids), ["a@b 2027-01-10→2027-01-14 0"])
  // Las dos plataformas dicen ocupado el mismo día: posible sobreventa entre ellas.
  const r = await sync(db, ids, [ev("y@air", "2027-01-12", "2027-01-16")], { source: "airbnb" })
  assert.equal(r.collisions, 1)
  assert.deepEqual(await blocks(db, ids, "airbnb"), ["x@air 2027-02-01→2027-02-05 2", "y@air 2027-01-14→2027-01-16 0"].sort((a, b) => a.split(" ")[1].localeCompare(b.split(" ")[1])))
  await db.close()
})

test("solo el sincronizador corre el sync y solo Operon ve lo pendiente", async () => {
  const { db, ids } = await fresh()
  assert.match((await attempt(db, "select sync_unit_external_blocks('token-falso', $1, 'booking', '[]'::jsonb, true)", [ids.unit_a])).error, /FORBIDDEN/)
  assert.match((await attempt(db, "select sync_unit_external_blocks($1, $2, 'vrbo', '[]'::jsonb, true)", [ids.ical_token, ids.unit_a])).error, /INVALID_SOURCE/)
  for (const [role, uid] of [["anon", ""], ["authenticated", ids.owner_a]]) {
    await as(db, role, { uid })
    assert.ok((await attempt(db, "select sync_unit_external_blocks($1, $2, 'booking', '[]'::jsonb, true)", [ids.ical_token, ids.unit_a])).error, role)
    assert.ok((await attempt(db, "select * from operon_ical_attention()")).error, role)
    assert.ok((await attempt(db, "select * from app_private.ical_sync_conflicts")).error, role)
  }
  await as(db, "postgres")

  await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-14"), ev("b@b", "2027-02-01", "2027-02-08"), ev("c@b", "2027-03-01", "2027-03-05")])
  await sync(db, ids, [ev("a@b", "2027-01-10", "2027-01-14"), ev("c@b", "2027-03-01", "2027-03-05")])
  await as(db, "authenticated", { uid: ids.admin })
  const pending = await rows(db, "select kind, unit_name, source, desde::text, hasta::text, missing_count from operon_ical_attention()")
  assert.deepEqual(pending, [{ kind: "missing", unit_name: "Cabaña A", source: "booking", desde: "2027-02-01", hasta: "2027-02-08", missing_count: 1 }])
  // Filtrado por organización: la otra no tiene nada.
  assert.equal((await rows(db, "select * from operon_ical_attention($1)", [ids.org_b])).length, 0)
  await db.close()
})
