import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const root = fileURLToPath(new URL('../../', import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { 'server-only': fileURLToPath(new URL('../api/mocks-zone/empty.mjs', import.meta.url)), '@/': root + 'src/' } })
const { cordobaEvents } = await jiti.import(root + 'src/lib/zone-month/cordoba-feed.ts')
const { collectMaterial } = await jiti.import(root + 'src/lib/zone-month/validation.ts')
const date = new Date('2026-09-28T12:00:00Z')
const base = {
  id: 904046, title: 'Oktoberfest 2026 en Villa General Belgrano',
  start_date: '2026-10-02 00:00:00', end_date: '2026-10-04 23:59:59',
  date: '2026-09-24 08:44:34',
  url: 'https://cordobaturismo.gov.ar/evento/oktoberfest-2026-en-villa-general-belgrano/',
}

test('agenda oficial Córdoba: filtra la ciudad, conserva fecha/URL y el material la valida', async () => {
  process.env.ZONE_CORDOBA_FEED_ZONES = 'AR:villa general belgrano'
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(url)
    return Response.json({ events: [base, { ...base, id: 999, title: 'Festival en otra ciudad' }, { ...base, id: 998, url: 'https://evil.example/evento/' }], total_pages: 1 })
  }
  try {
    const facts = await cordobaEvents('AR:villa general belgrano', '2026-10-01', date)
    assert.equal(calls.length, 1)
    assert.match(calls[0], /^https:\/\/cordobaturismo\.gov\.ar\/wp-json\/tribe\/events\/v1\/events\?/)
    assert.deepEqual(facts.map(f => f.id), ['cordoba-904046'])
    const material = collectMaterial({ version: 1, facts }, 'AR:villa general belgrano', '2026-10-01', date, ['cordobaturismo.gov.ar'])
    assert.equal(material.facts.length, 1)
    assert.match(material.warnings.at(-1), /automáticamente/)
  } finally { globalThis.fetch = original; delete process.env.ZONE_CORDOBA_FEED_ZONES }
})

test('fuente configurada caída o incompleta no se interpreta como ausencia de agenda', async () => {
  process.env.ZONE_CORDOBA_FEED_ZONES = 'AR:villa general belgrano'
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('bad', { status: 503 })
  try {
    await assert.rejects(() => cordobaEvents('AR:villa general belgrano', '2026-10-01', date), /invalid_sources/)
  } finally { globalThis.fetch = original; delete process.env.ZONE_CORDOBA_FEED_ZONES }
})

test('zona sin adaptador no consulta red ni inventa eventos', async () => {
  delete process.env.ZONE_CORDOBA_FEED_ZONES
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw Error('unexpected network') }
  try { assert.deepEqual(await cordobaEvents('AR:villa yacanto', '2026-10-01', date), []) }
  finally { globalThis.fetch = original }
})
