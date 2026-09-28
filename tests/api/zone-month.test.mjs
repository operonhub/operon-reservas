import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { state } from './mocks-zone/admin.mjs'
import { state as routeState } from './mocks-zone/worker.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const mocks = fileURLToPath(new URL('./mocks-zone/', import.meta.url))
const alias = {'server-only': mocks+'empty.mjs', '@/lib/supabase/admin': mocks+'admin.mjs', '@/':root+'src/'}
const jiti = createJiti(import.meta.url,{alias})
const {runZoneMonth} = await jiti.import(root+'src/lib/zone-month/worker.ts')
const {selectWithGemini} = await jiti.import(root+'src/lib/zone-month/gemini.ts')
const routeJiti = createJiti(import.meta.url,{alias:{...alias,'@/lib/zone-month/worker':mocks+'worker.mjs'},moduleCache:false})
const {GET} = await routeJiti.import(root+'src/app/api/cron/zone-month/route.ts')
const selection = {version:1,factIds:['ar-2026-oct-12'],commercial:'conditions',operational:'response',actions:['conditions','response','interests']}
const good = () => Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(selection)}]}}]})
const date = new Date('2026-09-28T12:00:00Z')
function reset() {
  state.jobs=[{zone:'AR:ushuaia',month:'2026-10-01',lease:'test-lease'}];state.calls=[];state.failMaterial=false;state.failFinish=false
  delete process.env.GEMINI_API_KEY;delete process.env.ZONE_SOURCE_PACK_JSON;delete process.env.ZONE_GEMINI_MODEL;delete process.env.ZONE_SOURCE_HOSTS;delete process.env.ZONE_CORDOBA_FEED_ZONES
}

test('cron fail-closed, sin autorización ni activación no llama worker; errores no filtran datos',async()=>{
  const req = token => new Request('https://local.test/api/cron/zone-month',{headers: token ? {authorization:token}:{}})
  delete process.env.CRON_SECRET; routeState.calls=0
  assert.equal((await GET(req('Bearer undefined'))).status,401)
  process.env.CRON_SECRET='test-secret'
  assert.equal((await GET(req('Bearer wrong'))).status,401)
  delete process.env.ZONE_MONTH_ENABLED
  assert.deepEqual(await (await GET(req('Bearer test-secret'))).json(),{enabled:false})
  assert.equal(routeState.calls,0)
  process.env.ZONE_MONTH_ENABLED='1'; delete process.env.DEMO_ONLY
  assert.equal((await GET(req('Bearer test-secret'))).status,200)
  routeState.fail=true
  const res=await GET(req('Bearer test-secret'))
  assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/sensitive/)
  delete process.env.CRON_SECRET;delete process.env.ZONE_MONTH_ENABLED
})

test('sin clave registra fallo explícito después de guardar fuentes; nunca publica fallback',async()=>{
  reset()
  const original=globalThis.fetch
  globalThis.fetch=async()=>{throw new Error('NO network expected')}
  try {
    const result=await runZoneMonth(date)
    assert.equal(result.failed,1)
    const finish=state.calls.find(c=>c.fn==='zone_month_finish')
    assert.equal(finish.args.p_error,'missing_key');assert.equal(finish.args.p_edition,null)
    assert.ok(state.calls.find(c=>c.fn==='zone_month_material').args.p_material.facts.length)
  } finally {globalThis.fetch=original}
})

test('payload Gemini solo zona/mes/fuentes públicas/catálogo; publicación tras validación y máximo tres trabajos',async()=>{
  reset();process.env.GEMINI_API_KEY='test-only'
  state.jobs=Array.from({length:4},()=>({zone:'AR:ushuaia',month:'2026-10-01',lease:'lease'}))
  const original=globalThis.fetch;const requests=[]
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return good()}
  try {
    assert.equal((await runZoneMonth(date)).published,3)
    assert.equal(requests.length,3);assert.equal(state.jobs.length,1)
    const body=JSON.parse(requests[0].options.body)
    assert.deepEqual(Object.keys(JSON.parse(body.contents[0].parts[0].text)).sort(),['catalog','month','sources','zone'])
    assert.equal(body.tools,undefined)
    assert.equal(requests[0].options.headers['x-goog-api-key'],'test-only')
    assert.ok(!requests[0].url.includes('test-only'))
    assert.equal(state.calls.filter(c=>c.fn==='zone_month_finish').length,3)
    for(const c of state.calls.filter(c=>c.fn==='zone_month_finish')) assert.deepEqual(c.args.p_edition.selection,selection)
  } finally {globalThis.fetch=original;delete process.env.GEMINI_API_KEY}
})

test('cuota y JSON inválido no publican; timeout no tiene retry inmediato',async()=>{
  const original=globalThis.fetch
  try {
    for(const [reply,code] of [[()=>new Response('',{status:429}),'quota'],[()=>Response.json({candidates:[]}), 'invalid_output'],[()=>{throw new DOMException('timeout','TimeoutError')},'timeout']]) {
      reset();process.env.GEMINI_API_KEY='test-only';let calls=0
      globalThis.fetch=async()=>{calls++;return reply()}
      assert.equal((await runZoneMonth(date)).failed,1)
      assert.equal(calls,1)
      const finish=state.calls.find(c=>c.fn==='zone_month_finish')
      assert.equal(finish.args.p_error,code);assert.equal(finish.args.p_edition,null)
    }
  } finally {globalThis.fetch=original;delete process.env.GEMINI_API_KEY}
})

test('fuentes mal configuradas y fuera de ventana no llaman Gemini; fallo DB no continúa',async()=>{
  reset();process.env.ZONE_SOURCE_PACK_JSON='not json'
  assert.equal((await runZoneMonth(date)).failed,1)
  assert.equal(state.calls.find(c=>c.fn==='zone_month_finish').args.p_error,'invalid_sources')
  reset();assert.equal((await runZoneMonth(new Date('2026-09-15'))).outsideWindow,true);assert.equal(state.calls.length,0)
  reset();state.failMaterial=true
  await assert.rejects(()=>runZoneMonth(date),/database/)
  assert.ok(!state.calls.some(c=>c.fn==='zone_month_finish'))
})

test('proveedor truncado, IDs falsos y prosa extra se rechazan',async()=>{
  const original=globalThis.fetch;process.env.GEMINI_API_KEY='test-only'
  try {
    for(const candidate of [{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}},{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...selection,factIds:['inventado']})}]}},{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...selection,text:'subir 20%'})}]}}]) {
      globalThis.fetch=async()=>Response.json({candidates:[candidate]})
      await assert.rejects(()=>selectWithGemini('AR:ushuaia','2026-10-01',{facts:[{id:'ar-2026-oct-12'}]},'gemini-2.5-flash-lite'),/invalid_output/)
    }
  } finally {globalThis.fetch=original;delete process.env.GEMINI_API_KEY}
})

test('feed oficial se suma a hechos públicos y limita el cron a dos zonas',async()=>{
  reset();process.env.GEMINI_API_KEY='test-only';process.env.ZONE_CORDOBA_FEED_ZONES='AR:villa general belgrano'
  state.jobs=Array.from({length:3},()=>({zone:'AR:villa general belgrano',month:'2026-10-01',lease:'lease'}))
  const event={id:904046,title:'Oktoberfest 2026 en Villa General Belgrano',start_date:'2026-10-02 00:00:00',end_date:'2026-10-04 23:59:59',date:'2026-09-24 08:44:34',url:'https://cordobaturismo.gov.ar/evento/oktoberfest-2026-en-villa-general-belgrano/'}
  const original=globalThis.fetch;let feeds=0,models=0
  globalThis.fetch=async(url)=>{
    if(String(url).startsWith('https://cordobaturismo.gov.ar/')){feeds++;return Response.json({events:[event],total_pages:1})}
    models++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...selection,factIds:['ar-2026-oct-12','cordoba-904046']})}]}}]})
  }
  try {
    const result=await runZoneMonth(date)
    assert.equal(result.published,2);assert.equal(feeds,2);assert.equal(models,2);assert.equal(state.jobs.length,1)
    const edition=state.calls.find(c=>c.fn==='zone_month_finish').args.p_edition
    assert.deepEqual(edition.material.facts.map(f=>f.id),['ar-2026-oct-12','cordoba-904046'])
  } finally {globalThis.fetch=original;reset()}
})
