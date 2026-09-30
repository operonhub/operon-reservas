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
const {runZoneMonth, runZoneMonthEdition, JOBS_PER_RUN} = await jiti.import(root+'src/lib/zone-month/worker.ts')
const routeJiti = createJiti(import.meta.url,{alias:{...alias,'@/lib/zone-month/worker':mocks+'worker.mjs'},moduleCache:false})
const {GET} = await routeJiti.import(root+'src/app/api/cron/zone-month/route.ts')

// Ventana: últimos cinco días de octubre generan noviembre.
const date = new Date('2026-10-28T12:00:00Z')
const AGENDA = 'https://turismo.tornquist.gob.ar/agenda'
const OBRAS = 'https://vialidad.gba.gob.ar/obras'
const EXTRA = 'https://diario.example.com.ar/nota'
const cite = (url, title) => ({type:'web_search_result_location',url,title,encrypted_index:'e',cited_text:'...'})
const message = (content, stop='end_turn', extra={}) => ({
  id:'msg_test',type:'message',role:'assistant',model:'claude-sonnet-5-5',content,stop_reason:stop,stop_sequence:null,
  usage:{input_tokens:1000,output_tokens:400,server_tool_use:{web_search_requests:2}}, ...extra,
})
const research = () => message([
  {type:'server_tool_use',id:'srvtoolu_1',name:'web_search',input:{query:'agenda villa ventana noviembre 2026'}},
  {type:'web_search_tool_result',tool_use_id:'srvtoolu_1',content:[{type:'web_search_result',url:AGENDA,title:'Agenda',encrypted_content:'x',page_age:null}]},
  {type:'text',text:'La Fiesta del Chocolate se hace del 14 al 16 de noviembre en Villa Ventana.',citations:[cite(AGENDA,'Agenda oficial de Tornquist')]},
  {type:'text',text:' Hay obras en la ruta 76.',citations:[cite(OBRAS,'Obras viales')]},
  {type:'text',text:' Un diario también lo menciona.',citations:[cite(EXTRA,'Nota')]},
])
// Salida del paso 2. Fuentes: [0] feriado curado, [1] agenda, [2] obras, [3] nota.
const written = {
  headline:'Noviembre llega con fiesta y fin de semana largo',
  overview:['Primavera plena en la comarca: días templados y mucho turismo de naturaleza.'],
  scope:'localidad',
  events:[
    {id:'fiesta-del-chocolate',title:'Fiesta del Chocolate',start:'2026-11-14',end:'2026-11-16',place:'Villa Ventana',summary:'Tres días de feria y gastronomía.',forHosts:'Llegan familias de Bahía Blanca: conviene publicar con dos semanas de anticipación.',sources:[1]},
    {id:'sin-fuente',title:'Evento sin fuente',start:'2026-11-20',end:'2026-11-20',place:null,summary:'x',forHosts:'y',sources:[]},
  ],
  calendar:[{kind:'finde_largo',title:'Fin de semana largo de la Soberanía',start:'2026-11-21',end:'2026-11-23',summary:'Tres días seguidos.',sources:[0]}],
  practical:[{title:'Obras en la ruta 76',text:'Demoras en el acceso: avisale a los huéspedes.',sources:[2]}],
  ideas:[{title:'Paquete fiesta',text:'Estadía mínima de dos noches con desayuno.',eventId:'fiesta-del-chocolate'},{title:'Idea suelta',text:'Algo.',eventId:'no-existe'}],
  messages:[{eventId:'fiesta-del-chocolate',channel:'whatsapp',text:'¡Hola! Desde {alojamiento} te contamos que se viene la Fiesta del Chocolate. Reservá en {link}'}],
}
const writeReply = (out=written, stop='end_turn') => message([{type:'text',text:typeof out==='string'?out:JSON.stringify(out)}], stop)

/** Simula la API: el paso 1 lleva la herramienta de búsqueda; el 2, formato JSON. */
function anthropic({ step1 = research, step2 = () => writeReply(), status } = {}) {
  const requests = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push({url:String(url), headers:new Headers(init.headers), body})
    if (status) return new Response(JSON.stringify({type:'error',error:{type:'x',message:'nope'}}),{status,headers:{'content-type':'application/json','retry-after-ms':'1'}})
    const reply = body.tools ? step1(requests.filter(r => r.body.tools).length) : step2()
    return new Response(JSON.stringify(reply),{status:200,headers:{'content-type':'application/json'}})
  }
  return requests
}
function reset() {
  state.jobs=[{zone:'AR:villa ventana',month:'2026-11-01',lease:'test-lease'}];state.calls=[];state.failMaterial=false;state.failFinish=false;state.editionRow=null
  state.place={city:'Villa Ventana',province_name:'Buenos Aires',department_name:'Tornquist'};state.interests={}
  for (const k of ['ANTHROPIC_API_KEY','ZONE_MODEL','ZONE_SOURCE_PACK_JSON','ZONE_SOURCE_HOSTS','ZONE_CORDOBA_FEED_ZONES']) delete process.env[k]
}
const originalFetch = globalThis.fetch
const finishes = () => state.calls.filter(c=>c.fn==='zone_month_finish')

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

test('sin clave: fallo explícito después de guardar las fuentes curadas; nunca publica relleno',async()=>{
  reset()
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('NO network expected')}
  try {
    assert.equal((await runZoneMonth(date)).failed,1)
    assert.equal(calls,0)
    assert.equal(finishes()[0].args.p_error,'missing_key');assert.equal(finishes()[0].args.p_edition,null)
    assert.ok(state.calls.find(c=>c.fn==='zone_month_material').args.p_material.facts.length)
  } finally {globalThis.fetch=originalFetch}
})

test('investiga y publica: solo datos públicos al modelo, fuentes de las citas reales, sin datos inventados',async()=>{
  reset();process.env.ANTHROPIC_API_KEY='test-only'
  state.interests={tarifas:2}
  const requests=anthropic()
  try {
    assert.equal((await runZoneMonth(date)).published,1)
    const [step1,step2]=requests
    // Paso 1: búsqueda web básica (citas garantizadas), localizada y con tope.
    assert.equal(step1.headers.get('x-api-key'),'test-only')
    assert.equal(step1.body.model,'claude-sonnet-5-5')
    assert.deepEqual(step1.body.tools.map(t=>[t.type,t.max_uses,t.user_location.city,t.user_location.region]),[['web_search_20250305',8,'Villa Ventana','Buenos Aires']])
    assert.equal(step1.body.fallbacks,'default')
    const prompt=step1.body.messages[0].content
    assert.match(prompt,/Villa Ventana/);assert.match(prompt,/Tornquist/);assert.match(prompt,/noviembre de 2026/)
    assert.match(prompt,/Tarifas y números \(2\)/)
    assert.doesNotMatch(prompt,/lease|organization|@/)
    // Paso 2: sin herramientas y con JSON estricto; ve las fuentes numeradas.
    assert.equal(step2.body.tools,undefined)
    assert.equal(step2.body.output_config.format.type,'json_schema')
    assert.match(step2.body.messages[0].content,/\[1\] Agenda oficial de Tornquist/)
    assert.match(step2.body.messages[0].content,/Fiesta del Chocolate.*\[1\]/)

    const edition=finishes()[0].args.p_edition
    assert.equal(edition.version,2)
    assert.equal(edition.place.department,'Tornquist')
    // El evento sin fuente se descarta; la idea con un evento inexistente queda suelta.
    assert.deepEqual(edition.events.map(e=>e.id),['fiesta-del-chocolate'])
    assert.equal(edition.ideas[1].eventId,null)
    // La nota que nadie cita se quita y las referencias se renumeran.
    assert.deepEqual(edition.sources.map(s=>s.url),['https://www.argentina.travel/novedades/feriados-en-argentina-2026-calendario-para-planificar-tu-viaje',AGENDA,OBRAS])
    assert.deepEqual([edition.calendar[0].sources,edition.events[0].sources,edition.practical[0].sources],[[0],[1],[2]])
    // El dossier y el consumo real quedan como evidencia.
    const material=state.calls.filter(c=>c.fn==='zone_month_material').at(-1).args.p_material
    assert.equal(material.version,2);assert.equal(material.usage.searches,2);assert.match(material.dossier,/\[1\]/)
  } finally {globalThis.fetch=originalFetch}
})

test('una fuente que el modelo inventa no puede entrar: solo índices de la lista armada con las citas',async()=>{
  reset();process.env.ANTHROPIC_API_KEY='test-only'
  anthropic({step2:()=>writeReply({...written,events:[{...written.events[0],sources:[9]}],calendar:[],practical:[]})})
  try {
    assert.equal((await runZoneMonth(date)).failed,1)
    assert.equal(finishes()[0].args.p_error,'invalid_output')
  } finally {globalThis.fetch=originalFetch}
})

test('sin citas de la web, JSON roto, rechazo o respuesta cortada: no se publica',async()=>{
  const cases=[
    [{step1:()=>message([{type:'text',text:'No encontré nada.'}])},'invalid_output'],
    [{step2:()=>writeReply('{roto')},'invalid_output'],
    [{step2:()=>writeReply(written,'max_tokens')},'invalid_output'],
    [{step1:()=>message([{type:'text',text:'No.'}],'refusal')},'provider'],
    [{status:401},'missing_key'],
    [{status:429},'quota'],
  ]
  try {
    for(const [opts,code] of cases){
      reset();process.env.ANTHROPIC_API_KEY='test-only';anthropic(opts)
      assert.equal((await runZoneMonth(date)).failed,1,code)
      assert.equal(finishes()[0].args.p_error,code)
      assert.equal(finishes()[0].args.p_edition,null)
    }
  } finally {globalThis.fetch=originalFetch}
})

test('una búsqueda larga pausada (pause_turn) se retoma con el turno tal cual',async()=>{
  reset();process.env.ANTHROPIC_API_KEY='test-only'
  const paused=message([{type:'server_tool_use',id:'srvtoolu_p',name:'web_search',input:{query:'q'}}],'pause_turn')
  const requests=anthropic({step1:n=>n===1?paused:research()})
  try {
    assert.equal((await runZoneMonth(date)).published,1)
    const resumed=requests.filter(r=>r.body.tools)[1].body.messages
    assert.deepEqual(resumed.map(m=>m.role),['user','assistant'])
    assert.equal(resumed[1].content[0].id,'srvtoolu_p')
  } finally {globalThis.fetch=originalFetch}
})

test(`hasta ${JOBS_PER_RUN} pueblos por corrida, en paralelo`,async()=>{
  reset();process.env.ANTHROPIC_API_KEY='test-only'
  state.jobs=Array.from({length:6},(_,i)=>({zone:'AR:villa ventana',month:'2026-11-01',lease:'l'+i}))
  anthropic()
  try {
    const result=await runZoneMonth(date)
    assert.equal(result.processed,JOBS_PER_RUN);assert.equal(result.published,JOBS_PER_RUN)
    assert.equal(state.jobs.length,2)
    // Las zonas salen de la base: el worker no le pasa ninguna lista.
    assert.equal(state.calls.find(c=>c.fn==='zone_month_claim_enabled').args,undefined)
  } finally {globalThis.fetch=originalFetch}
})

test('fuentes mal configuradas y fuera de ventana no llaman a la IA; fallo DB no continúa',async()=>{
  reset();process.env.ZONE_SOURCE_PACK_JSON='not json'
  assert.equal((await runZoneMonth(date)).failed,1)
  assert.equal(finishes()[0].args.p_error,'invalid_sources')
  reset();assert.equal((await runZoneMonth(new Date('2026-10-15'))).outsideWindow,true);assert.equal(state.calls.length,0)
  reset();state.failMaterial=true
  await assert.rejects(()=>runZoneMonth(date),/database/)
  assert.ok(!state.calls.some(c=>c.fn==='zone_month_finish'))
})

test('sin clientes habilitados el cron no llama a la IA ni falla',async()=>{
  reset();state.jobs=[]
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('no')}
  try {
    assert.deepEqual(await runZoneMonth(date),{processed:0,published:0,failed:0,outsideWindow:false})
    assert.equal(calls,0)
    assert.deepEqual(state.calls.map(c=>c.fn),['zone_month_claim_enabled'])
  } finally {globalThis.fetch=originalFetch}
})

test('generar ahora: una sola edición fuera de la ventana, y avisa si falló o si ya estaba en curso',async()=>{
  try {
    reset();process.env.ANTHROPIC_API_KEY='test-only';anthropic()
    const outside=new Date('2026-11-10T12:00:00Z')
    state.jobs=[{zone:'AR:villa ventana',month:'2026-11-01',lease:'l1'},{zone:'AR:villa ventana',month:'2026-11-01',lease:'l2'}]
    assert.deepEqual(await runZoneMonthEdition('AR:villa ventana','2026-11-01',outside),{status:'published'})
    assert.deepEqual(state.calls[0],{fn:'zone_month_claim_edition',args:{p_zone:'AR:villa ventana',p_month:'2026-11-01'}})
    assert.equal(finishes().length,1)

    reset();process.env.ANTHROPIC_API_KEY='test-only';anthropic({status:429})
    state.editionRow={error_code:'quota'}
    assert.deepEqual(await runZoneMonthEdition('AR:villa ventana','2026-11-01',outside),{status:'failed',code:'quota'})

    reset();state.jobs=[]
    assert.deepEqual(await runZoneMonthEdition('AR:villa ventana','2026-11-01',outside),{status:'busy'})
  } finally {globalThis.fetch=originalFetch}
})

test('el feed oficial de Córdoba entra como fecha confirmada en la investigación',async()=>{
  reset();process.env.ANTHROPIC_API_KEY='test-only';process.env.ZONE_CORDOBA_FEED_ZONES='AR:villa general belgrano'
  state.jobs=[{zone:'AR:villa general belgrano',month:'2026-10-01',lease:'lease'}]
  state.place={city:'Villa General Belgrano',province_name:'Córdoba',department_name:'Calamuchita'}
  const event={id:904046,title:'Oktoberfest 2026 en Villa General Belgrano',start_date:'2026-10-02 00:00:00',end_date:'2026-10-04 23:59:59',date:'2026-09-24 08:44:34',url:'https://cordobaturismo.gov.ar/evento/oktoberfest-2026-en-villa-general-belgrano/'}
  let feeds=0
  const requests=anthropic({
    step1:()=>message([{type:'text',text:'La Oktoberfest es del 2 al 4 de octubre.',citations:[cite('https://www.vgb.gov.ar/oktoberfest','Oktoberfest')]}]),
    step2:()=>writeReply({...written,events:[{...written.events[0],id:'oktoberfest',title:'Oktoberfest',start:'2026-10-02',end:'2026-10-04',sources:[1]}],calendar:[],practical:[]}),
  })
  const anthropicFetch=globalThis.fetch
  globalThis.fetch=async(url,init)=>{
    if(String(url).startsWith('https://cordobaturismo.gov.ar/')){feeds++;return Response.json({events:[event],total_pages:1})}
    return anthropicFetch(url,init)
  }
  try {
    assert.equal((await runZoneMonth(new Date('2026-09-28T12:00:00Z'))).published,1)
    assert.equal(feeds,1)
    assert.match(requests[0].body.messages[0].content,/Oktoberfest 2026 en Villa General Belgrano: 2026-10-02 al 2026-10-04/)
    assert.deepEqual(state.calls.find(c=>c.fn==='zone_month_material').args.p_material.facts.map(f=>f.id),['ar-2026-oct-12','cordoba-904046'])
  } finally {globalThis.fetch=originalFetch;reset()}
})
