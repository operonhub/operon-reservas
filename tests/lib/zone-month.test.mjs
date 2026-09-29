import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
import { readFileSync } from 'node:fs'
const jiti = createJiti(import.meta.url)
const { collectMaterial, validateSelection, validateEdition, zoneKey, targetMonth } = await jiti.import('../../src/lib/zone-month/validation.ts')
const { CLOSING, TITLES } = await jiti.import('../../src/lib/zone-month/content.ts')
const pack = JSON.parse(readFileSync(new URL('../../src/lib/zone-month/sources.json', import.meta.url)))
const now = new Date('2026-09-28T12:00:00Z')
const collect = (p = pack, zone = 'AR:ushuaia', month = '2026-10-01') => collectMaterial(p, zone, month, now, ['www.argentina.travel', 'prensa.jujuy.gob.ar'])
const selection = { version: 1, factIds: ['ar-2026-oct-12'], commercial: 'conditions', operational: 'response', actions: ['conditions', 'response', 'interests'] }

test('zona solo por ciudad/país, vacíos y datos ajenos se rechazan', () => {
  assert.equal(zoneKey(' ar ', '  San   Martín '), 'AR:san martín')
  for (const [country, city] of [[null, 'Ushuaia'], ['AR', ''], ['AR', 'a@example.org'], ['AR', 'Calle 123'], ['ARG', 'Ushuaia']]) assert.equal(zoneKey(country, city), null)
})
test('ventana UTC exacta: últimos cinco días antes del mes siguiente', () => {
  for (const [date, month] of [['2026-09-25', null], ['2026-09-26', '2026-10-01'], ['2026-09-30', '2026-10-01'], ['2026-10-01', null], ['2026-12-26', null], ['2026-12-27', '2027-01-01'], ['2028-02-24', null], ['2028-02-25', '2028-03-01'], ['2028-02-29', '2028-03-01']]) assert.equal(targetMonth(new Date(date)), month, date)
})
test('recopilación preserva procedencia, filtra mes/zona y declara falta de agenda', () => {
  const m = collect()
  assert.equal(m.facts.length, 1)
  assert.equal(m.facts[0].start, '2026-10-12')
  assert.ok(m.warnings.some(w => w.includes('No hay agenda local corroborada')))
  assert.equal(collect(pack, 'CL:pucon').facts.length, 0)
  assert.equal(collect(pack, 'AR:ushuaia', '2027-01-01').facts.length, 0)
  const stale = structuredClone(pack); stale.facts[0].checked = '2026-09-26'; stale.facts[0].validUntil = '2026-09-27'
  assert.equal(collect(stale).facts.length, 0)
})
test('Huacalera recibe sólo su evento oficial; Purmamarca declara agenda no corroborada', () => {
  const huacalera = collect(pack, 'AR:huacalera')
  assert.deepEqual(huacalera.facts.map(f => f.id), ['ar-2026-oct-12', 'jujuy-huacalera-2026-oct-ttt'])
  assert.ok(!huacalera.warnings.some(w => w.includes('No hay agenda local corroborada')))
  const purmamarca = collect(pack, 'AR:purmamarca')
  assert.deepEqual(purmamarca.facts.map(f => f.id), ['ar-2026-oct-12'])
  assert.ok(purmamarca.warnings.some(w => w.includes('No hay agenda local corroborada')))
})
test('fuentes: URL confiable, fechas reales, revisión pasada, vencimiento acotado y sin PII', () => {
  for (const patch of [{url: 'http://www.argentina.travel/x'}, {url: 'https://evil.example/x'}, {url: 'https://www.argentina.travel@evil.example/x'}, {url: 'https://www.argentina.travel/x?key=foo'}, {start: '2026-02-30'}, {checked: '2026-10-01'}, {validUntil: '2027-12-31'}, {title: 'Huésped ana@example.org'}, {kind: 'inventado'}, {private: 'data'}]) {
    const bad = structuredClone(pack); Object.assign(bad.facts[0], patch)
    assert.throws(() => collect(bad), /invalid_sources/, JSON.stringify(patch))
  }
})
test('Gemini solo puede elegir catálogo e IDs corroborados: tres acciones sin prosa arbitraria', () => {
  const material = collect()
  assert.deepEqual(validateSelection(selection, material), selection)
  for (const patch of [{factIds: ['evento-falso']}, {factIds: []}, {actions: ['conditions', 'response']}, {actions: ['conditions', 'conditions', 'response']}, {actions: ['conditions','response','subir-precio']}, {commercial: 'subir-precio'}, {operational: 'tu-web-falla'}, {text: 'Tu ocupación cayó un 20%'}, {actions: ['interests','agenda','review']}]) assert.throws(() => validateSelection({...selection, ...patch}, material), /invalid_output/)
  const empty = collect(pack, 'CL:pucon')
  assert.deepEqual(validateSelection({...selection, factIds: []}, empty).factIds, [])
})
test('lectura valida identidad, cinco títulos y cierre exacto; conserva archivo histórico', () => {
  const edition = {version: 1, zone: 'AR:ushuaia', month: '2026-10-01', material: collect(), selection}
  assert.deepEqual(validateEdition(edition, edition.zone, edition.month), edition)
  assert.throws(() => validateEdition(edition, 'AR:otra ciudad', edition.month))
  assert.throws(() => validateEdition(edition, edition.zone, '2026-11-01'))
  assert.equal(TITLES.length, 5)
  assert.equal(CLOSING, '¿Qué te gustaría profundizar el próximo mes: tarifas y números, conseguir reservas, turismo de la zona o gestión del alojamiento?')
})
