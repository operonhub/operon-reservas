import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDb, as, attempt } from './harness.mjs'
import { seed } from './seed.mjs'

// Única sustitución para fijar el reloj: conserva el cuerpo real de la RPC.
const migration = readFileSync(new URL('../../supabase/migrations/0030_zone_month.sql', import.meta.url), 'utf8')
async function clock(db, timestamp = '2026-09-28 12:00:00+00') {
  await as(db, 'postgres')
  const fn = migration.match(/create function public.zone_month_claim\(\)[\s\S]+?end; \$\$;/)[0]
  await db.exec(fn.replace('create function', 'create or replace function').replaceAll('now()', `('${timestamp}'::timestamptz)`))
}
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0]
const claim = async db => (await one(db, 'select zone_month_claim() j')).j
async function fresh() {
  const db = await createDb(); const ids = await seed(db)
  await db.query("update properties set city = case when organization_id = $1 then 'Ushuaia' else 'Salta' end, country = 'AR'", [ids.org_a])
  await clock(db)
  return {db, ids}
}

test('RLS: zonas diferentes aisladas, zona compartida y cambio de localización; sin escritura libre', async () => {
  const {db, ids} = await fresh()
  try {
    await db.exec("insert into zone_month_editions(zone,month) values ('AR:ushuaia','2026-10-01'),('AR:salta','2026-10-01')")
    for (const user of [ids.owner_a, ids.admin_a, ids.staff_a]) {
      await as(db, 'authenticated', {uid:user})
      assert.deepEqual((await db.query('select zone from zone_month_editions')).rows, [{zone:'AR:ushuaia'}])
      assert.ok((await attempt(db, "insert into zone_month_editions(zone,month) values ('AR:ushuaia','2026-11-01')")).error)
      assert.equal((await db.query("update zone_month_editions set attempts=3 returning zone")).rows.length,0)
      assert.equal((await db.query('delete from zone_month_editions returning zone')).rows.length,0)
      assert.ok((await attempt(db, 'select zone_month_claim()')).error)
      assert.ok((await attempt(db, "select zone_month_material('AR:ushuaia','2026-10-01',gen_random_uuid(),'{}','x')")).error)
      assert.ok((await attempt(db, "select zone_month_finish('AR:ushuaia','2026-10-01',gen_random_uuid(),null,'quota')")).error)
    }
    await as(db,'anon')
    assert.equal((await db.query('select * from zone_month_editions')).rows.length,0)
    assert.ok((await attempt(db, 'select zone_month_claim()')).error)
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
    await as(db,'service_role')
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

test('crash final pasa a fallo, tres intentos máximo y ventana cerrada no encola', async () => {
  const {db,ids} = await fresh()
  try {
    await db.query('update properties set city=null where id=$1',[ids.prop_b])
    await clock(db,'2026-09-15 12:00:00+00'); await as(db,'service_role'); assert.equal(await claim(db),null)
    for (const day of [28,29,30]) {
      await clock(db,`2026-09-${day} 12:00:00+00`); await as(db,'service_role')
      assert.equal((await claim(db)).attempts,day-27)
    }
    await clock(db,'2026-10-01 12:00:00+00'); await as(db,'service_role'); assert.equal(await claim(db),null)
    await as(db,'postgres')
    assert.equal((await one(db,'select status from zone_month_editions')).status,'failed')
    assert.equal((await one(db,'select error_code from zone_month_editions')).error_code,'interrupted')
  } finally { await db.close() }
})

test('lease vencido fuera de la ventana se marca fallido sin encolar otro mes', async () => {
  const {db} = await fresh()
  try {
    await as(db,'postgres')
    await db.exec("insert into zone_month_editions(zone,month,status,attempts,lease,started_at) values ('AR:ushuaia','2026-10-01','processing',3,gen_random_uuid(),'2026-10-07 12:00:00+00')")
    await clock(db,'2026-10-08 12:00:00+00'); await as(db,'service_role')
    assert.equal(await claim(db),null)
    await as(db,'postgres')
    const row=await one(db,"select status,error_code,lease from zone_month_editions where zone='AR:ushuaia'")
    assert.equal(row.status,'failed');assert.equal(row.error_code,'interrupted');assert.equal(row.lease,null)
    assert.equal((await one(db,'select count(*)::int n from zone_month_editions')).n,1)
  } finally { await db.close() }
})
