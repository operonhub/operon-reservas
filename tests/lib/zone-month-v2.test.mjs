/**
 * Tu zona v2 (0037): el formato del informe y el cálculo de "Tu complejo".
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("../api/mocks-zone/", import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { "server-only": mocks + "empty.mjs", "@/": root + "src/" }, moduleCache: false })
const v2 = await jiti.import(root + "src/lib/zone-month/edition-v2.ts")
const yp = await jiti.import(root + "src/lib/zone-month/your-property.ts")
const { pruneSources } = await jiti.import(root + "src/lib/zone-month/research.ts")

const meta = {
  zone: "AR:villa ventana", month: "2026-11-01", collectedAt: "2026-10-28T12:00:00.000Z", model: "claude-sonnet-5-5",
  place: { locality: "Villa Ventana", department: "Tornquist", province: "Buenos Aires" },
  sources: [{ url: "https://turismo.tornquist.gob.ar/agenda", title: "Agenda" }, { url: "https://www.argentina.gob.ar/feriados", title: "Feriados" }],
}
const raw = () => ({
  headline: "Un mes con fiesta", overview: ["Primavera en la comarca."], scope: "localidad",
  events: [{ id: "fiesta", title: "Fiesta", start: "2026-11-14", end: "2026-11-16", place: null, status: "confirmado", summary: "Feria.", forHosts: "Publicalo antes.", sources: [0] }],
  calendar: [{ kind: "finde_largo", title: "Finde largo", start: "2026-11-21", end: "2026-11-23", summary: "Tres días.", sources: [1] }],
  practical: [], ideas: [{ title: "Paquete", text: "Dos noches.", eventId: "fiesta" }],
  messages: [{ eventId: null, channel: "whatsapp", text: "Hola desde {alojamiento}\nReservá en {link}" }],
})
const build = (r = raw()) => v2.normalizeEditionV2(r, meta)

test("una edición bien armada pasa la validación estricta", () => {
  const e = v2.validateEditionV2(build(), meta.zone, meta.month)
  assert.equal(e.version, 2)
  assert.equal(e.place.department, "Tornquist")
  assert.equal(e.messages[0].text, "Hola desde {alojamiento}\nReservá en {link}")
})

test("se limpia lo que no corresponde: HTML, links sueltos, fechas fuera del mes, datos sin fuente", () => {
  const r = raw()
  r.headline = "<b>Un mes</b> con fiesta https://spam.example.com"
  r.events.push(
    { id: "lejos", title: "En enero", start: "2027-01-10", end: "2027-01-10", place: null, summary: "x", forHosts: "y", sources: [0] },
    { id: "sin-fuente", title: "Rumor", start: "2026-11-20", end: "2026-11-20", place: null, summary: "x", forHosts: "y", sources: [] },
    { id: "fecha-rota", title: "Mal", start: "2026-11-31", end: "2026-11-31", place: null, summary: "x", forHosts: "y", sources: [0] },
    { id: "fuente-falsa", title: "Invento", start: "2026-11-05", end: "2026-11-05", place: null, summary: "x", forHosts: "y", sources: [7] },
  )
  r.ideas.push({ title: "Otra", text: "x", eventId: "no-existe" })
  const e = build(r)
  assert.equal(e.headline, "Un mes con fiesta")
  assert.deepEqual(e.events.map(x => x.id), ["fiesta"])
  assert.equal(e.ideas[1].eventId, null)
  assert.doesNotThrow(() => v2.validateEditionV2(e, meta.zone, meta.month))
})

test("un evento sin año verificado queda a confirmar y no se promociona en mensajes", () => {
  const r = raw()
  r.events.push({ id: "rugby", title: "Rugby", start: "2026-11-08", end: "2026-11-12", place: null, status: "otro", summary: "x", forHosts: "y", sources: [0] })
  r.messages.push({ eventId: "rugby", channel: "instagram", text: "Vení al rugby {link}" })
  const e = build(r)
  assert.equal(e.events.find(x => x.id === "rugby").status, "a_confirmar")
  assert.equal(e.messages.length, 1)
  assert.doesNotThrow(() => v2.validateEditionV2(e, meta.zone, meta.month))
  assert.throws(() => v2.validateEditionV2({ ...e, events: e.events.map(x => ({ ...x, status: "quizas" })) }, meta.zone, meta.month), /invalid_output/)
})

test("los textos largos se recortan sin cortar palabras", () => {
  const long = "palabra ".repeat(200).trim()
  const clipped = v2.clip(long, 140)
  assert.ok(clipped.length <= 140 && clipped.endsWith("…") && !clipped.includes("palab…"))
})

test("la validación estricta rechaza lo que no pasó por la limpieza", () => {
  const ok = build()
  const bad = [
    { ...ok, version: 1 },
    { ...ok, zone: "AR:salta" },
    { ...ok, headline: "Mirá https://x.com" },
    { ...ok, overview: [] },
    { ...ok, events: [{ ...ok.events[0], sources: [] }] },
    { ...ok, events: [{ ...ok.events[0], sources: [5] }] },
    { ...ok, events: [{ ...ok.events[0], start: "2027-02-01", end: "2027-02-01" }] },
    { ...ok, sources: [{ url: "http://inseguro.com/x", title: "x" }, ok.sources[1]] },
    { ...ok, sources: [...ok.sources, ok.sources[0]] },
    { ...ok, ideas: [] },
    { ...ok, extra: true },
    { ...ok, events: [], calendar: [], practical: [] },
  ]
  for (const e of bad) assert.throws(() => v2.validateEditionV2(e, meta.zone, meta.month), /invalid_output/, JSON.stringify(e).slice(0, 80))
})

test("pruneSources deja solo las fuentes citadas y renumera", () => {
  const e = build()
  const withExtra = { ...e, sources: [{ url: "https://nadie.cita/esto", title: "x" }, ...e.sources], events: e.events.map(x => ({ ...x, sources: [1] })), calendar: e.calendar.map(x => ({ ...x, sources: [2] })) }
  const pruned = pruneSources(withExtra)
  assert.deepEqual(pruned.sources.map(s => s.url), e.sources.map(s => s.url))
  assert.deepEqual([pruned.events[0].sources, pruned.calendar[0].sources], [[0], [1]])
})

test("noches de una fecha clave: el día de salida no se cuenta y se recorta al mes", () => {
  assert.deepEqual(yp.parseRange("[2026-11-01,2026-11-05)"), { start: "2026-11-01", end: "2026-11-05" })
  assert.deepEqual(yp.parseRange("[2026-11-01,2026-11-05]"), { start: "2026-11-01", end: "2026-11-06" })
  assert.equal(yp.parseRange("empty"), null)
  // Viernes a domingo: noches del viernes y el sábado.
  assert.deepEqual(yp.stayFor("2026-11-13", "2026-11-15", "2026-11-01"), { start: "2026-11-13", end: "2026-11-15" })
  // Un solo día: esa noche.
  assert.deepEqual(yp.stayFor("2026-11-23", "2026-11-23", "2026-11-01"), { start: "2026-11-23", end: "2026-11-24" })
  // Empieza en octubre o termina en diciembre: solo lo que cae en noviembre.
  assert.deepEqual(yp.stayFor("2026-10-30", "2026-11-02", "2026-11-01"), { start: "2026-11-01", end: "2026-11-02" })
  assert.deepEqual(yp.stayFor("2026-11-29", "2026-12-03", "2026-11-01"), { start: "2026-11-29", end: "2026-12-01" })
  assert.equal(yp.stayFor("2026-12-05", "2026-12-06", "2026-11-01"), null)
})

test("el martes de referencia esquiva las fechas clave", () => {
  // Noviembre de 2026: martes 3, 10, 17, 24.
  assert.deepEqual(yp.referenceNight("2026-11-01", []), { start: "2026-11-03", end: "2026-11-04" })
  assert.deepEqual(yp.referenceNight("2026-11-01", [{ start: "2026-11-01", end: "2026-11-12" }]), { start: "2026-11-17", end: "2026-11-18" })
})
