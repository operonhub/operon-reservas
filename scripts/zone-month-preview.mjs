/**
 * Genera "Tu zona este mes" para un pueblo SIN guardar nada en la base:
 * imprime el informe, el dossier, las búsquedas y el costo real.
 *
 *   node scripts/zone-month-preview.mjs "Villa Ventana" "Tornquist" "Buenos Aires" 2026-11-01
 *
 * Lee ANTHROPIC_API_KEY (y ZONE_MODEL, opcional) de .env.local. Cada corrida
 * cuesta unos centavos de dólar.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../", import.meta.url))
for (const line of readFileSync(root + ".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^(ANTHROPIC_API_KEY|ZONE_MODEL)=(.*)$/)
  if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Falta ANTHROPIC_API_KEY en .env.local")
  process.exit(1)
}

const [locality, department, province, month] = process.argv.slice(2)
if (!locality || !/^\d{4}-\d{2}-01$/.test(month ?? "")) {
  console.error('Uso: node scripts/zone-month-preview.mjs "Localidad" "Departamento" "Provincia" AAAA-MM-01')
  process.exit(1)
}

const jiti = createJiti(import.meta.url, { alias: { "server-only": root + "tests/api/mocks-zone/empty.mjs", "@/": root + "src/" } })
const { researchZone } = await jiti.import(root + "src/lib/zone-month/research.ts")
const { collectMaterial, zoneKey } = await jiti.import(root + "src/lib/zone-month/validation.ts")
const pack = JSON.parse(readFileSync(root + "src/lib/zone-month/sources.json", "utf8"))

const zone = zoneKey("AR", locality)
const now = new Date()
const facts = collectMaterial(pack, zone, month, now, ["www.argentina.travel", "www.argentina.gob.ar", "prensa.jujuy.gob.ar"]).facts
const started = Date.now()
const { edition, dossier, usage, model } = await researchZone({
  zone, month, facts, interests: {},
  place: { locality, department: department || null, province: province || null },
}, now)

// Sonnet 5.5: US$2 / US$10 por millón de tokens; búsqueda web: US$10 cada 1.000.
const cost = usage.input / 1e6 * 2 + usage.output / 1e6 * 10 + usage.searches * 0.01
const out = root + `zone-preview-${zone.replace(/[^a-z0-9]+/gi, "-")}-${month.slice(0, 7)}.json`
writeFileSync(out, JSON.stringify({ edition, dossier, usage, model }, null, 2))
console.log(JSON.stringify({
  modelo: model, segundos: Math.round((Date.now() - started) / 1000), busquedas: usage.searches,
  tokens: { entrada: usage.input, salida: usage.output }, costoUSD: Number(cost.toFixed(3)),
  eventos: edition.events.length, calendario: edition.calendar.length, practico: edition.practical.length,
  ideas: edition.ideas.length, mensajes: edition.messages.length, fuentes: edition.sources.length, archivo: out,
}, null, 2))
