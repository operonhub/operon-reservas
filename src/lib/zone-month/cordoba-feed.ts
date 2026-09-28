import "server-only"
import type { Fact } from "./content"
import { GenerationError, validDate, zoneKey } from "./validation"

const HOST = "cordobaturismo.gov.ar"
const ENDPOINT = `https://${HOST}/wp-json/tribe/events/v1/events`

/** Fuente pública directa; nunca usa resultados de Google Grounding. */
export async function cordobaEvents(zone: string, month: string, now: Date): Promise<Fact[]> {
  const enabled = (process.env.ZONE_CORDOBA_FEED_ZONES || "").split(",").map(s => s.trim().toLowerCase())
  if (!enabled.includes(zone.toLowerCase())) return []
  if (!zone.startsWith("AR:") || !validDate(month) || !month.endsWith("-01")) throw new GenerationError("invalid_sources")
  const city = zone.slice(3)
  if (zoneKey("AR", city) !== zone) throw new GenerationError("invalid_sources")
  const nextMonth = new Date(`${month}T00:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const lastDay = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10)
  const facts: Fact[] = []
  const today = now.toISOString().slice(0, 10)
  try {
    for (let page = 1; page <= 2; page++) {
      const url = `${ENDPOINT}?start_date=${month}&end_date=${lastDay}&per_page=50&page=${page}`
      const response = await fetch(url, { signal: AbortSignal.timeout(7000), cache: "no-store", headers: { Accept: "application/json" } })
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("feed_status")
      const text = await response.text()
      if (text.length > 700000) throw new Error("feed_size")
      const data = JSON.parse(text)
      if (!Array.isArray(data.events) || !Number.isInteger(data.total_pages) || data.total_pages < 0 || data.total_pages > 2) throw new Error("feed_shape")
      for (const event of data.events) {
        if (!event || !Number.isSafeInteger(event.id) || event.id < 1 || typeof event.title !== "string") continue
        const title = event.title.trim()
        if (!title || title.length > 180 || /[<>@\r\n]|https?:|\b\d{7,}\b/i.test(title)) continue
        // No inferir región o proximidad desde el texto libre de la descripción.
        if (!title.toLocaleLowerCase("es-AR").includes(city.toLocaleLowerCase("es-AR"))) continue
        if (typeof event.start_date !== "string" || typeof event.end_date !== "string" || typeof event.date !== "string") continue
        const start = event.start_date.slice(0, 10)
        const end = event.end_date.slice(0, 10)
        const published = event.date.slice(0, 10)
        if (![start, end, published].every(validDate) || start > end || start.slice(0, 7) !== month.slice(0, 7) || published > today || end < today) continue
        let source: URL
        try { source = new URL(event.url) } catch { continue }
        if (source.protocol !== "https:" || source.hostname !== HOST || source.port || source.search || source.hash || !source.pathname.startsWith("/evento/")) continue
        if (facts.some(f => f.id === `cordoba-${event.id}`)) continue
        facts.push({
          id: `cordoba-${event.id}`, kind: "event", country: "AR", city,
          title, start, end, url: source.href, publisher: "Córdoba Turismo",
          published, checked: today, validUntil: end,
          evidence: `Agenda oficial de Córdoba Turismo: ${title}, ${start} al ${end}.`,
        })
      }
      if (page >= data.total_pages) break
    }
  } catch {
    // Una fuente caída no equivale a ausencia de eventos: no publicar con silencio.
    throw new GenerationError("invalid_sources")
  }
  return facts.slice(0, 12)
}
