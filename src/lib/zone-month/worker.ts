import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Json } from "@/lib/supabase/types"
import { ERRORS, type Edition } from "./content"
import { collectMaterial, GenerationError, targetMonth, zoneKey } from "./validation"
import { geminiTimeoutMs, modelName, selectWithGemini } from "./gemini"
import { cordobaEvents } from "./cordoba-feed"
import defaultPack from "./sources.json"

export async function runZoneMonth(now = new Date()) {
  if (!targetMonth(now)) return { processed: 0, published: 0, failed: 0, outsideWindow: true }
  const allowedZones = (process.env.ZONE_MONTH_ALLOWED_ZONES || "").split(",").map(z => z.trim()).filter(Boolean)
  if (!allowedZones.length || allowedZones.length > 10 || new Set(allowedZones).size !== allowedZones.length ||
    allowedZones.some(z => {
      const parts = z.split(":")
      return parts.length !== 2 || zoneKey(parts[0], parts[1]) !== z
    })) throw new Error("zone allowlist missing or invalid")
  const db = createAdminClient()
  const result = { processed: 0, published: 0, failed: 0, outsideWindow: false }
  // Dos zonas por cron cubren ambos clientes; limitar a una si el feed más Gemini
  // pueden consumir casi el minuto completo de esta función.
  const limit = process.env.ZONE_CORDOBA_FEED_ZONES?.trim() && geminiTimeoutMs() > 18000 ? 1 : 2
  for (let i = 0; i < limit; i++) {
    const { data, error } = await db.rpc("zone_month_claim", { p_allowed_zones: allowedZones })
    if (error) throw new Error("database")
    if (!data) break
    const job = data as { zone: string; month: string; lease: string }
    let edition: Edition | null = null
    let code: string | null = null
    try {
      let pack: unknown = defaultPack
      if (process.env.ZONE_SOURCE_PACK_JSON) {
        try {
          if (process.env.ZONE_SOURCE_PACK_JSON.length > 64000) throw new Error("size")
          pack = JSON.parse(process.env.ZONE_SOURCE_PACK_JSON)
        } catch { throw new GenerationError("invalid_sources") }
      }
      const hosts = ["www.argentina.travel", "www.argentina.gob.ar", "prensa.jujuy.gob.ar", "cordobaturismo.gov.ar", ...(process.env.ZONE_SOURCE_HOSTS || "").split(",").map(h => h.trim()).filter(Boolean)]
      const curated = collectMaterial(pack, job.zone, job.month, now, hosts)
      const events = await cordobaEvents(job.zone, job.month, now)
      const selectedEvents = events.slice(0, Math.max(0, 12 - curated.facts.length))
      const material = selectedEvents.length
        ? collectMaterial({ version: 1, facts: [...curated.facts, ...selectedEvents] }, job.zone, job.month, now, hosts)
        : curated
      const model = modelName()
      const saved = await db.rpc("zone_month_material", { p_zone: job.zone, p_month: job.month, p_lease: job.lease, p_material: material as unknown as Json, p_model: model })
      if (saved.error || !saved.data) throw new Error("database")
      const selection = await selectWithGemini(job.zone, job.month, material, model)
      edition = { version: 1, zone: job.zone, month: job.month, material, selection }
    } catch (error) {
      if (!(error instanceof GenerationError)) throw error
      code = Object.hasOwn(ERRORS, error.code) ? error.code : "provider"
    }
    const finished = await db.rpc("zone_month_finish", {
      p_zone: job.zone, p_month: job.month, p_lease: job.lease,
      p_edition: edition as unknown as Json | null, p_error: code,
    })
    if (finished.error || !finished.data) throw new Error("database")
    result.processed++
    if (edition) result.published++; else result.failed++
  }
  return result
}
