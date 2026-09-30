/**
 * Salud de los calendarios de Airbnb/Booking (migración 0035), contra el
 * esquema real en PGlite.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb, as, attempt } from './harness.mjs'
import { seed } from './seed.mjs'

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0]
async function fresh() {
  const db = await createDb(); const ids = await seed(db)
  await db.query("update units set airbnb_ical_url = 'https://www.airbnb.com/calendar/ical/1.ics?s=SECRETO'")
  await db.query("update units set booking_ical_url = 'https://admin.booking.com/ical/2.ics?t=SECRETO' where id = $1", [ids.unit_a])
  ids.admin = (await one(db, "insert into auth.users (email) values ('santiago@operonhub.test') returning id")).id
  await db.query('insert into platform_admins (user_id) values ($1)', [ids.admin])
  return {db, ids}
}
const report = (db, ids, results) =>
  db.query('select report_ical_sync_results($1, $2) n', [ids.ical_token, JSON.stringify(results)])
const overview = async (db, ids, org) => {
  await as(db, 'authenticated', {uid: ids.admin})
  return (await db.query('select * from operon_ical_overview($1)', [org ?? null])).rows
}

test('solo el sincronizador reporta y solo los admins de Operon leen', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db, 'service_role')
    assert.match((await attempt(db, "select report_ical_sync_results('token-falso', '[]')")).error, /FORBIDDEN/)
    for (const [role, uid] of [['anon', ''], ['authenticated', ids.owner_a]]) {
      await as(db, role, {uid})
      assert.ok((await attempt(db, 'select report_ical_sync_results($1, $2)', [ids.ical_token, '[]'])).error, role)
      assert.ok((await attempt(db, 'select * from operon_ical_overview()')).error, role)
      assert.ok((await attempt(db, 'select * from app_private.ical_sync_status')).error, role)
    }
  } finally { await db.close() }
})

test('guarda el último éxito y el último error por calendario, con fallas seguidas', async () => {
  const {db, ids} = await fresh()
  try {
    // Antes de la primera corrida: pendiente.
    const before = await overview(db, ids, ids.org_a)
    assert.deepEqual(before.map((r) => [r.source, r.state]), [['airbnb', 'pending'], ['booking', 'pending']])

    await as(db, 'service_role')
    await report(db, ids, [
      {unit_id: ids.unit_a, source: 'airbnb', ok: true, error: null},
      {unit_id: ids.unit_a, source: 'booking', ok: false, error: 'HTTP_404'},
    ])
    await report(db, ids, [{unit_id: ids.unit_a, source: 'booking', ok: false, error: 'HTTP_404'}])

    let rows = await overview(db, ids, ids.org_a)
    const airbnb = rows.find((r) => r.source === 'airbnb')
    const booking = rows.find((r) => r.source === 'booking')
    assert.equal(airbnb.state, 'ok'); assert.equal(airbnb.failures, 0)
    assert.equal(booking.state, 'error'); assert.equal(booking.last_error, 'HTTP_404'); assert.equal(booking.failures, 2)

    // Se arregla: vuelve a 0 fallas y queda el error viejo como historia.
    await as(db, 'service_role')
    await report(db, ids, [{unit_id: ids.unit_a, source: 'booking', ok: true}])
    rows = await overview(db, ids, ids.org_a)
    const fixed = rows.find((r) => r.source === 'booking')
    assert.equal(fixed.state, 'ok'); assert.equal(fixed.failures, 0); assert.equal(fixed.last_error, 'HTTP_404')
  } finally { await db.close() }
})

test('nunca guarda texto libre ni el link, y tolera basura en el reporte', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db, 'service_role')
    const {n} = await one(db, 'select report_ical_sync_results($1, $2) n', [ids.ical_token, JSON.stringify([
      {unit_id: ids.unit_a, source: 'airbnb', ok: false, error: 'fetch failed https://www.airbnb.com/calendar/ical/1.ics?s=SECRETO'},
      {unit_id: ids.unit_a, source: 'airbnb', ok: false, error: 'HTTP_500'},
      {unit_id: 'no-es-un-uuid', source: 'airbnb', ok: true},
      {unit_id: '00000000-0000-0000-0000-000000000000', source: 'airbnb', ok: true},
      {unit_id: ids.unit_b, source: 'vrbo', ok: true},
      {unit_id: ids.unit_b, source: 'airbnb', ok: 'sí'},
    ])])
    // Solo el calendario real de unit_a, una vez aunque venga repetido.
    assert.equal(n, 1)
    await as(db, 'postgres')
    const stored = await one(db, 'select last_error from app_private.ical_sync_status')
    assert.match(stored.last_error, /^(SYNC_FAILED|HTTP_500)$/)
    assert.doesNotMatch(JSON.stringify(await overview(db, ids)), /SECRETO|airbnb\.com|booking\.com/)

    await as(db, 'service_role')
    const tooMany = Array.from({length: 2001}, () => ({unit_id: ids.unit_a, source: 'airbnb', ok: true}))
    assert.match((await attempt(db, 'select report_ical_sync_results($1, $2)', [ids.ical_token, JSON.stringify(tooMany)])).error, /TOO_MANY_RESULTS/)
  } finally { await db.close() }
})

test('estados: sin sincronizar hace horas, complejo suspendido y unidades sin calendario', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db, 'service_role')
    await report(db, ids, [{unit_id: ids.unit_b, source: 'airbnb', ok: true}])
    await as(db, 'postgres')
    await db.query("update app_private.ical_sync_status set last_ok_at = now() - interval '5 hours'")
    assert.equal((await overview(db, ids, ids.org_b))[0].state, 'stale')

    await db.query("select operon_suspend_org($1, 'Prueba')", [ids.org_b])
    assert.equal((await overview(db, ids, ids.org_b))[0].state, 'paused')

    // Sin link configurado no aparece; una unidad inactiva tampoco.
    await as(db, 'postgres')
    await db.query('update units set booking_ical_url = null, is_active = true where id = $1', [ids.unit_a])
    await db.query('update units set is_active = false where id = $1', [ids.unit_b])
    const all = await overview(db, ids)
    assert.deepEqual(all.map((r) => [r.unit_id, r.source]), [[ids.unit_a, 'airbnb']])
  } finally { await db.close() }
})
