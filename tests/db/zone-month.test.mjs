import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDb, as, attempt } from './harness.mjs'
import { seed } from './seed.mjs'

// Única sustitución para fijar el reloj: conserva el cuerpo real de cada RPC,
// tomado de la migración más nueva que la define (0037 reemplaza la cola).
const read = (file) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')
const migrations = [read('0037_tu_zona_v2.sql'), read('0034_zone_month_por_cliente.sql')]
const CLOCKED = ['zone_month_claim_enabled', 'zone_month_claim_edition', 'operon_zone_month_queue', 'operon_zone_month_overview']
function definition(name) {
  const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]+?end; \\$\\$;`)
  for (const sql of migrations) { const m = sql.match(pattern); if (m) return m[0] }
  throw new Error('sin definición: ' + name)
}
async function clock(db, timestamp = '2026-09-28 12:00:00+00') {
  await as(db, 'postgres')
  for (const name of CLOCKED) {
    const fn = definition(name)
    await db.query(fn.replace(/^create (?:or replace )?function/, 'create or replace function').replaceAll('now()', `('${timestamp}'::timestamptz)`))
  }
}
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0]
const claim = async (db) => (await one(db, 'select zone_month_claim_enabled() j')).j
async function enable(db, ...orgs) {
  await as(db, 'postgres')
  for (const org of orgs) await db.query('update organizations set zone_month_enabled_at = now() where id = $1', [org])
  await as(db, 'service_role')
}
async function fresh() {
  const db = await createDb(); const ids = await seed(db)
  await db.query("update properties set city = case when organization_id = $1 then 'Ushuaia' else 'Salta' end, country = 'AR'", [ids.org_a])
  await clock(db)
  await as(db, 'postgres')
  ids.admin = (await one(db, "insert into auth.users (email) values ('santiago@operonhub.test') returning id")).id
  await db.query('insert into platform_admins (user_id) values ($1)', [ids.admin])
  return {db, ids}
}

test('RLS: zonas diferentes aisladas, zona compartida y cambio de localización; sin escritura libre', async () => {
  const {db, ids} = await fresh()
  try {
    await db.query("insert into zone_month_editions(zone,month) values ('AR:ushuaia','2026-10-01'),('AR:salta','2026-10-01')")
    for (const user of [ids.owner_a, ids.admin_a, ids.staff_a]) {
      await as(db, 'authenticated', {uid:user})
      assert.deepEqual((await db.query('select zone from zone_month_editions')).rows, [{zone:'AR:ushuaia'}])
      assert.ok((await attempt(db, "insert into zone_month_editions(zone,month) values ('AR:ushuaia','2026-11-01')")).error)
      assert.equal((await db.query("update zone_month_editions set attempts=3 returning zone")).rows.length,0)
      assert.equal((await db.query('delete from zone_month_editions returning zone')).rows.length,0)
      assert.ok((await attempt(db, "select zone_month_claim_enabled()")).error)
      assert.ok((await attempt(db, "select zone_month_claim_edition('AR:ushuaia','2026-10-01')")).error)
      assert.ok((await attempt(db, "select zone_month_material('AR:ushuaia','2026-10-01',gen_random_uuid(),'{}','x')")).error)
      assert.ok((await attempt(db, "select zone_month_finish('AR:ushuaia','2026-10-01',gen_random_uuid(),null,'quota')")).error)
      // Un cliente no se activa ni se genera solo.
      assert.ok((await attempt(db, 'select operon_set_zone_month($1, true)', [ids.org_a])).error)
      assert.ok((await attempt(db, "select operon_zone_month_queue($1,'AR:ushuaia','2026-10-01')", [ids.org_a])).error)
      assert.ok((await attempt(db, 'select * from operon_zone_month_overview()')).error)
    }
    await as(db,'anon')
    assert.equal((await db.query('select * from zone_month_editions')).rows.length,0)
    assert.ok((await attempt(db, "select zone_month_claim_enabled()")).error)
    await as(db,'authenticated',{uid:ids.owner_b})
    assert.deepEqual((await db.query('select zone from zone_month_editions')).rows,[{zone:'AR:salta'}])
    await db.query("update properties set city = 'Ushuaia' where id=$1",[ids.prop_b])
    assert.deepEqual((await db.query('select zone from zone_month_editions')).rows,[{zone:'AR:ushuaia'}])
    await db.query('update properties set city=null where id=$1',[ids.prop_b])
    assert.equal((await db.query('select * from zone_month_editions')).rows.length,0)
  } finally { await db.close() }
})

test('worker: una edición por zona/mes, leases, no duplicación, reintentos acotados y publicación inmutable', async () => {
  const {db, ids} = await fresh()
  try {
    await db.query("update properties set city='Ushuaia' where id=$1",[ids.prop_b])
    await enable(db, ids.org_a, ids.org_b)
    const j = await claim(db)
    assert.equal(j.zone,'AR:ushuaia'); assert.equal(j.month,'2026-10-01')
    assert.equal(await claim(db),null)
    assert.equal((await one(db,"select zone_month_finish($1,$2,gen_random_uuid(),null,'quota') ok",[j.zone,j.month])).ok,false)
    assert.equal((await one(db,"select zone_month_material($1,$2,$3,'{}','test-model') ok",[j.zone,j.month,j.lease])).ok,true)
    await db.query("select zone_month_finish($1,$2,$3,null,'quota')",[j.zone,j.month,j.lease])
    assert.equal(await claim(db),null)
    await clock(db,'2026-09-29 12:00:00+00'); await as(db,'service_role')
    const retry = await claim(db); assert.equal(retry.attempts,2)
    assert.notEqual(retry.lease,j.lease)
    assert.equal((await one(db,"select zone_month_finish($1,$2,$3,null,'quota') ok",[j.zone,j.month,j.lease])).ok,false)
    const edition = {version:1,zone:j.zone,month:j.month}
    assert.equal((await one(db,'select zone_month_finish($1,$2,$3,$4,null) ok',[j.zone,j.month,retry.lease,edition])).ok,true)
    assert.equal(await claim(db),null)
    assert.equal((await one(db,"select zone_month_finish($1,$2,$3,null,'quota') ok",[j.zone,j.month,retry.lease])).ok,false)
    await as(db,'postgres')
    assert.equal((await one(db,'select count(*)::int n from zone_month_editions')).n,1)
  } finally { await db.close() }
})

test('solo se generan las zonas de clientes habilitados, no suspendidos y con equipo', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db,'service_role')
    // Nadie habilitado: el cron no hace nada (y no es un error).
    assert.equal(await claim(db), null)
    await enable(db, ids.org_b)
    assert.equal((await claim(db)).zone,'AR:salta')
    assert.equal(await claim(db),null)
    await as(db,'postgres')
    assert.deepEqual((await db.query('select zone from zone_month_editions')).rows,[{zone:'AR:salta'}])

    // Suspendido o sin equipo: su zona sale de la lista.
    await db.query("update organizations set zone_month_enabled_at = now(), suspended_at = now() where id = $1", [ids.org_a])
    await as(db,'service_role'); assert.equal(await claim(db), null)
    await as(db,'postgres')
    await db.query('update organizations set suspended_at = null where id = $1', [ids.org_a])
    await db.query('delete from memberships where organization_id = $1', [ids.org_a])
    await as(db,'service_role'); assert.equal(await claim(db), null)
    await as(db,'postgres')
    assert.equal((await one(db,"select count(*)::int n from zone_month_editions where zone = 'AR:ushuaia'")).n, 0)
  } finally { await db.close() }
})

test('crash final pasa a fallo, tres intentos máximo y ventana cerrada no encola', async () => {
  const {db,ids} = await fresh()
  try {
    await db.query('update properties set city=null where id=$1',[ids.prop_b])
    await enable(db, ids.org_a)
    await clock(db,'2026-09-25 12:00:00+00'); await as(db,'service_role'); assert.equal(await claim(db),null)
    await clock(db,'2026-09-26 12:00:00+00'); await as(db,'service_role'); assert.equal((await claim(db)).attempts,1)
    for (const day of [28,29]) {
      await clock(db,`2026-09-${day} 12:00:00+00`); await as(db,'service_role')
      assert.equal((await claim(db)).attempts,day===28 ? 2 : 3)
    }
    await clock(db,'2026-09-30 12:00:00+00'); await as(db,'service_role'); assert.equal(await claim(db),null)
    await clock(db,'2026-10-01 12:00:00+00'); await as(db,'service_role'); assert.equal(await claim(db),null)
    await as(db,'postgres')
    assert.equal((await one(db,'select status from zone_month_editions')).status,'failed')
    assert.equal((await one(db,'select error_code from zone_month_editions')).error_code,'interrupted')
  } finally { await db.close() }
})

test('lease vencido fuera de la ventana se marca fallido sin encolar otro mes', async () => {
  const {db, ids} = await fresh()
  try {
    await enable(db, ids.org_a)
    await as(db, 'postgres')
    await db.query("insert into zone_month_editions(zone,month,status,attempts,lease,started_at) values ('AR:ushuaia','2026-10-01','processing',3,gen_random_uuid(),'2026-10-07 12:00:00+00')")
    await clock(db,'2026-10-08 12:00:00+00'); await as(db,'service_role')
    assert.equal(await claim(db),null)
    await as(db,'postgres')
    const row=await one(db,"select status,error_code,lease from zone_month_editions where zone='AR:ushuaia'")
    assert.equal(row.status,'failed');assert.equal(row.error_code,'interrupted');assert.equal(row.lease,null)
    assert.equal((await one(db,'select count(*)::int n from zone_month_editions')).n,1)
  } finally { await db.close() }
})

test('panel: activar y desactivar un cliente, con registro; suspendido no se activa', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db, 'authenticated', {uid: ids.admin})
    assert.equal((await one(db, 'select operon_set_zone_month($1, true) ok', [ids.org_a])).ok, true)
    // Repetir no cambia nada ni ensucia el registro.
    assert.equal((await one(db, 'select operon_set_zone_month($1, true) ok', [ids.org_a])).ok, false)
    assert.equal((await one(db, 'select operon_set_zone_month($1, false) ok', [ids.org_a])).ok, true)

    await db.query("select operon_suspend_org($1, 'No pagó')", [ids.org_b])
    assert.match((await attempt(db, 'select operon_set_zone_month($1, true)', [ids.org_b])).error, /ORG_SUSPENDED/)

    await as(db, 'postgres')
    const log = (await db.query("select action from app_private.admin_audit_log where action like 'zone_month.%' order by id")).rows
    assert.deepEqual(log.map((r) => r.action), ['zone_month.enable', 'zone_month.disable'])
  } finally { await db.close() }
})

test('panel: tope de 10 zonas para cuidar el costo de la investigación', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db, 'postgres')
    for (let i = 0; i < 10; i++) {
      const {id: org} = await one(db, "insert into organizations (name, slug, zone_month_enabled_at) values ($1, $2, now()) returning id", [`Org ${i}`, `org-${i}`])
      await db.query("insert into properties (organization_id, name, slug, city, country) values ($1, 'P', 'p', $2, 'AR')", [org, `Ciudad ${String.fromCharCode(97 + i)}`])
      await db.query("insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [org, ids.owner_b])
    }
    await as(db, 'authenticated', {uid: ids.admin})
    assert.match((await attempt(db, 'select operon_set_zone_month($1, true)', [ids.org_a])).error, /ZONE_CAP/)
    // Una ciudad que ya está activa no suma zona.
    await as(db, 'postgres')
    await db.query("update properties set city = 'Ciudad a' where id = $1", [ids.prop_a])
    await as(db, 'authenticated', {uid: ids.admin})
    assert.equal((await one(db, 'select operon_set_zone_month($1, true) ok', [ids.org_a])).ok, true)
  } finally { await db.close() }
})

test('panel: generar ahora crea la edición, reintentar da un intento más y una publicada se puede rehacer', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db, 'authenticated', {uid: ids.admin})
    const queue = (zone, month) => attempt(db, 'select operon_zone_month_queue($1, $2, $3) q', [ids.org_a, zone, month])

    assert.match((await queue('AR:ushuaia', '2026-10-01')).error, /ZONE_NOT_ENABLED/)
    await db.query('select operon_set_zone_month($1, true)', [ids.org_a])
    assert.match((await queue('AR:salta', '2026-10-01')).error, /ZONE_NOT_IN_ORG/)
    assert.match((await queue('AR:ushuaia', '2026-12-01')).error, /MONTH_OUT_OF_RANGE/)

    // No existía: queda pendiente y el worker la reclama fuera de la ventana de cinco días.
    await clock(db, '2026-09-10 12:00:00+00')
    await as(db, 'authenticated', {uid: ids.admin})
    assert.equal((await queue('AR:ushuaia', '2026-09-01')).rows[0].q.previous_status, 'pending')
    await as(db, 'service_role')
    const job = (await one(db, "select zone_month_claim_edition('AR:ushuaia', '2026-09-01') j")).j
    assert.equal(job.attempts, 1)
    // Mientras se genera, no se puede volver a pedir.
    await as(db, 'authenticated', {uid: ids.admin})
    assert.match((await queue('AR:ushuaia', '2026-09-01')).error, /ALREADY_RUNNING/)

    // Falló tres veces: reintentar da exactamente un intento más.
    await as(db, 'postgres')
    await db.query("update zone_month_editions set status='failed', attempts=3, error_code='quota', lease=null where zone='AR:ushuaia'")
    await as(db, 'authenticated', {uid: ids.admin})
    assert.equal((await queue('AR:ushuaia', '2026-09-01')).rows[0].q.previous_status, 'failed')
    await as(db, 'postgres')
    const row = await one(db, "select status, attempts, error_code from zone_month_editions where zone='AR:ushuaia'")
    assert.deepEqual(row, {status: 'pending', attempts: 2, error_code: null})
    await as(db, 'service_role')
    const again = (await one(db, "select zone_month_claim_edition('AR:ushuaia', '2026-09-01') j")).j
    assert.equal(again.attempts, 3)
    await db.query("select zone_month_finish('AR:ushuaia', '2026-09-01', $1, $2, null)", [again.lease, {version: 1, zone: 'AR:ushuaia', month: '2026-09-01'}])

    // Publicada: se puede rehacer (0037). Deja de verse y vuelve con tres intentos.
    await as(db, 'authenticated', {uid: ids.admin})
    assert.equal((await queue('AR:ushuaia', '2026-09-01')).rows[0].q.previous_status, 'published')
    await as(db, 'postgres')
    assert.deepEqual(await one(db, "select status, attempts, edition, published_at from zone_month_editions where zone='AR:ushuaia'"),
      {status: 'pending', attempts: 0, edition: null, published_at: null})
    await as(db, 'service_role')
    const redo = (await one(db, "select zone_month_claim_edition('AR:ushuaia', '2026-09-01') j")).j
    assert.equal(redo.attempts, 1)
    await db.query("select zone_month_finish('AR:ushuaia', '2026-09-01', $1, $2, null)", [redo.lease, {version: 2, zone: 'AR:ushuaia', month: '2026-09-01'}])
    // Solo versiones conocidas: una v3 no se publica.
    await as(db, 'postgres')
    await db.query("update zone_month_editions set status='processing', lease=gen_random_uuid(), edition=null, published_at=null where zone='AR:ushuaia'")
    const lease = (await one(db, "select lease from zone_month_editions where zone='AR:ushuaia'")).lease
    await as(db, 'service_role')
    assert.ok((await attempt(db, "select zone_month_finish('AR:ushuaia', '2026-09-01', $1, $2, null)", [lease, {version: 3, zone: 'AR:ushuaia', month: '2026-09-01'}])).error)

    // Una zona que no está habilitada no se puede reclamar a mano.
    await as(db, 'service_role')
    assert.match((await attempt(db, "select zone_month_claim_edition('AR:salta', '2026-09-01')")).error, /ZONE_NOT_ENABLED/)

    await as(db, 'postgres')
    const log = (await db.query("select detail from app_private.admin_audit_log where action = 'zone_month.queue' order by id")).rows
    assert.deepEqual(log.map((r) => [r.detail.previous_status, r.detail.previous_error]), [['pending', null], ['failed', 'quota'], ['published', null]])
  } finally { await db.close() }
})

test('panel: resumen por cliente con el estado del mes actual y el próximo', async () => {
  const {db, ids} = await fresh()
  try {
    await as(db, 'postgres')
    await db.query("insert into zone_month_editions(zone, month, status, attempts, error_code) values ('AR:ushuaia', '2026-10-01', 'failed', 3, 'quota')")
    await db.query("update properties set city = null where id = $1", [ids.prop_b])
    await as(db, 'authenticated', {uid: ids.admin})
    await db.query('select operon_set_zone_month($1, true)', [ids.org_a])

    const rows = (await db.query('select * from operon_zone_month_overview()')).rows
    const a = rows.find((r) => r.organization_id === ids.org_a)
    assert.ok(a.enabled_at)
    assert.equal(a.missing_location, false)
    assert.deepEqual(a.zones, [{zone: 'AR:ushuaia', current: null, next: {status: 'failed', attempts: 3, error_code: 'quota', published_at: null, started_at: null}}])

    const b = rows.find((r) => r.organization_id === ids.org_b)
    assert.equal(b.enabled_at, null)
    assert.equal(b.missing_location, true)
    assert.deepEqual(b.zones, [])

    assert.equal((await db.query('select * from operon_zone_month_overview($1)', [ids.org_b])).rows.length, 1)
  } finally { await db.close() }
})

test('respuestas del dueño: solo su complejo, valores válidos, y a la IA solo llega la cuenta de la zona', async () => {
  const {db, ids} = await fresh()
  try {
    const save = async (uid, org, interests, done = []) => {
      await as(db, 'authenticated', {uid})
      return attempt(db, "select zone_month_save_feedback($1, '2026-10-01', $2, $3) ok", [org, interests, done])
    }
    assert.equal((await save(ids.owner_a, ids.org_a, ['tarifas', 'turismo', 'tarifas'], ['idea-0'])).rows[0].ok, true)
    assert.equal((await save(ids.staff_a, ids.org_a, ['reservas'], ['idea-0', 'idea-2'])).rows[0].ok, true)
    // Otro complejo, no; valores fuera de lista, no; meses que no empiezan el 1, no.
    assert.match((await save(ids.owner_b, ids.org_a, ['tarifas'])).error, /FORBIDDEN/)
    assert.match((await save(ids.owner_a, ids.org_a, ['precios'])).error, /INVALID_INTERESTS/)
    assert.match((await save(ids.owner_a, ids.org_a, [], ['Idea 1'])).error, /INVALID_DONE/)
    await as(db, 'authenticated', {uid: ids.owner_a})
    assert.match((await attempt(db, "select zone_month_save_feedback($1, '2026-10-02', '{}', '{}')", [ids.org_a])).error, /INVALID_MONTH/)

    // Cada uno ve solo lo suyo; nadie escribe directo en la tabla.
    assert.deepEqual((await db.query('select interests, done from zone_month_feedback')).rows, [{interests: ['reservas'], done: ['idea-0', 'idea-2']}])
    assert.ok((await attempt(db, "insert into zone_month_feedback(organization_id, month) values ($1, '2026-11-01')", [ids.org_a])).error)
    await as(db, 'authenticated', {uid: ids.owner_b})
    assert.equal((await db.query('select * from zone_month_feedback')).rows.length, 0)

    // La edición de noviembre de Ushuaia recibe los intereses de octubre, contados por complejo.
    await as(db, 'postgres')
    await db.query("update properties set city = 'Ushuaia' where id = $1", [ids.prop_b])
    await as(db, 'authenticated', {uid: ids.owner_b})
    await db.query("select zone_month_save_feedback($1, '2026-10-01', '{reservas,gestion}', '{}')", [ids.org_b])
    assert.ok((await attempt(db, "select zone_month_interests('AR:ushuaia', '2026-11-01')")).error)
    await as(db, 'service_role')
    assert.deepEqual((await one(db, "select zone_month_interests('AR:ushuaia', '2026-11-01') j")).j, {reservas: 2, gestion: 1})
    assert.deepEqual((await one(db, "select zone_month_interests('AR:salta', '2026-11-01') j")).j, {})
    assert.deepEqual((await one(db, "select zone_month_interests('AR:ushuaia', '2026-12-01') j")).j, {})
  } finally { await db.close() }
})
