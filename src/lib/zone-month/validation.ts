import { PRACTICES, type Edition, type Fact, type Material, type Selection } from "./content"

export class GenerationError extends Error {
  constructor(public code: string) { super(code) }
}
function check(ok: unknown, code = "invalid_output"): asserts ok { if (!ok) throw new GenerationError(code) }
function object(value: unknown): Record<string, unknown> {
  check(value && typeof value === "object" && !Array.isArray(value))
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[]) {
  check(Object.keys(value).sort().join(",") === keys.sort().join(","))
}
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
export function zoneKey(country: string | null, city: string | null): string | null {
  const c = country?.trim().toUpperCase()
  const t = city?.trim().toLowerCase().replace(/\s+/g, " ")
  return c && /^[A-Z]{2}$/.test(c) && t && t.length <= 100 && /^[\p{L} .'-]+$/u.test(t) ? `${c}:${t}` : null
}
export function targetMonth(now: Date): string | null {
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  if (now.getUTCDate() < last - 6 && now.getUTCDate() > 7) return null
  const month = now.getUTCDate() <= 7 ? now.getUTCMonth() : now.getUTCMonth() + 1
  return new Date(Date.UTC(now.getUTCFullYear(), month, 1)).toISOString().slice(0, 10)
}
function publicText(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !/[<>@\r\n]|https?:|\b\d{7,}\b/i.test(value)
}
/** Solo paquetes editoriales públicos de operadores de confianza; nunca texto de usuarios. */
export function collectMaterial(raw: unknown, zone: string, month: string, now: Date, trustedHosts: string[]): Material {
  try {
    check(validDate(month) && month.endsWith("-01"))
    const pack = object(raw)
    exact(pack, ["version", "facts"])
    check(pack.version === 1 && Array.isArray(pack.facts) && pack.facts.length <= 100)
    const today = now.toISOString().slice(0, 10)
    const ids = new Set<string>()
    const all = pack.facts.map((entry): Fact => {
      const f = object(entry)
      exact(f, ["id", "kind", "country", "city", "title", "start", "end", "url", "publisher", "published", "checked", "validUntil", "evidence"])
      check(typeof f.id === "string" && /^[a-z0-9-]{1,80}$/.test(f.id) && !ids.has(f.id)); ids.add(f.id)
      check(f.kind === "holiday" || f.kind === "event")
      check(typeof f.country === "string" && /^[A-Z]{2}$/.test(f.country))
      check(f.city === null || (typeof f.city === "string" && zoneKey(f.country, f.city)))
      check(f.kind !== "event" || f.city !== null)
      check(publicText(f.title, 180) && publicText(f.publisher, 120) && publicText(f.evidence, 400))
      check([f.start, f.end, f.published, f.checked, f.validUntil].every(validDate))
      const fact = f as unknown as Fact
      check(fact.start <= fact.end && fact.published <= fact.checked && fact.checked <= today && fact.checked <= fact.validUntil)
      check(Date.parse(fact.validUntil) - Date.parse(fact.checked) <= 100 * 86400000)
      check(typeof f.url === "string" && f.url.length <= 500)
      const url = new URL(fact.url)
      check(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && trustedHosts.includes(url.hostname))
      return fact
    })
    const facts = all.filter(f => f.country === zone.split(":")[0] && (!f.city || zoneKey(f.country, f.city) === zone) &&
      f.start.slice(0, 7) === month.slice(0, 7) && f.end >= month && f.validUntil >= today)
    check(facts.length <= 12)
    const warnings: string[] = []
    if (!facts.some(f => f.kind === "event")) warnings.push("No hay agenda local corroborada en las fuentes vigentes de esta edición. Esto no significa que no existan eventos.")
    if (!facts.some(f => f.kind === "holiday")) warnings.push("No hay feriados corroborados para este mes en el paquete disponible.")
    warnings.push(facts.some(f => f.id.startsWith("cordoba-"))
      ? "Agenda consultada automáticamente de Córdoba Turismo al preparar la edición; comprobá cambios o cancelaciones en el enlace oficial. No es una previsión de demanda."
      : "Fuentes recopiladas por curaduría; no es una comprobación en tiempo real ni una previsión de demanda.")
    return { version: 1, collectedAt: now.toISOString(), facts, warnings }
  } catch { throw new GenerationError("invalid_sources") }
}
export function validateSelection(raw: unknown, material: Material): Selection {
  const s = object(raw)
  exact(s, ["version", "factIds", "commercial", "operational", "actions"])
  check(s.version === 1)
  // Todos los hechos recopilados deben conservarse; el modelo solo puede ordenarlos.
  check(Array.isArray(s.factIds) && s.factIds.length === material.facts.length && new Set(s.factIds).size === s.factIds.length)
  check(s.factIds.every(id => typeof id === "string" && material.facts.some(f => f.id === id)))
  check(s.commercial === "conditions" || s.commercial === "stay")
  check(s.operational === "response" || s.operational === "arrival")
  check(Array.isArray(s.actions) && s.actions.length === 3 && new Set(s.actions).size === 3)
  check(s.actions.every(id => typeof id === "string" && Object.hasOwn(PRACTICES, id)))
  check(s.actions.includes(s.commercial) && s.actions.includes(s.operational))
  return s as unknown as Selection
}
/** Revalidación al leer: datos corruptos nunca se convierten en HTML publicado. */
export function validateEdition(raw: unknown, zone: string, month: string): Edition {
  const e = object(raw)
  exact(e, ["version", "zone", "month", "material", "selection"])
  check(e.version === 1 && e.zone === zone && e.month === month)
  const m = object(e.material)
  exact(m, ["version", "collectedAt", "facts", "warnings"])
  check(m.version === 1 && typeof m.collectedAt === "string" && !Number.isNaN(Date.parse(m.collectedAt)))
  check(Array.isArray(m.facts) && Array.isArray(m.warnings) && m.warnings.every(w => publicText(w, 400)))
  // Conserva validez histórica usando la fecha de recopilación, no la de lectura.
  const hosts = m.facts.map(f => new URL(String(object(f).url)).hostname)
  const material = collectMaterial({ version: 1, facts: m.facts }, zone, month, new Date(m.collectedAt), hosts)
  check(material.facts.length === m.facts.length)
  return { version: 1, zone, month, material, selection: validateSelection(e.selection, material) }
}
