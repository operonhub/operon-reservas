import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Json } from "@/lib/supabase/types"
import { ERRORS, type Edition } from "./content"
import { collectMaterial, GenerationError, targetMonth } from "./validation"
import { geminiTimeoutMs, modelName, selectWithGemini } from "./gemini"
import { cordobaEvents } from "./cordoba-feed"
import defaultPack from "./sources.json"

type Job = { zone: string; month: string; lease: string }
type AdminDb = ReturnType<typeof createAdminClient>

/**
 * Cron diario: genera la edición del mes siguiente en los últimos cinco días
 * UTC. Las zonas salen de la base (clientes habilitados desde /operon, 0034),
 * no del entorno.
 */
export async function runZoneMonth(now = new Date()) {
  if (!targetMonth(now)) return { processed: 0, published: 0, failed: 0, outsideWindow: true }
  const db = createAdminClient()
  const result = { processed: 0, published: 0, failed: 0, outsideWindow: false }
  // Dos zonas por cron; limitar a una si el feed más Gemini pueden consumir
  // casi el minuto completo de esta función.
  const limit = process.env.ZONE_CORDOBA_FEED_ZONES?.trim() && geminiTimeoutMs() > 18000 ? 1 : 2
  for (let i = 0; i < limit; i++) {
    const { data, error } = await db.rpc("zone_month_claim_enabled")
    if (error) throw new Error("database")
    if (!data) break
    const published = await processJob(db, data as Job, now)
    result.processed++
    if (published) result.published++; else result.failed++
  }
  return result
}

/**
 * "Generar ahora" desde el panel de Operon: una edición puntual, fuera de la
 * ventana. La RPC exige que la zona esté habilitada y que el mes sea el actual
 * o el próximo; el admin ya la dejó pendiente con operon_zone_month_queue.
 */
export async function runZoneMonthEdition(zone: string, month: string, now = new Date()) {
  const db = createAdminClient()
  const { data, error } = await db.rpc("zone_month_claim_edition", { p_zone: zone, p_month: month })
  if (error) throw new Error("database")
  if (!data) return { status: "busy" as const }
  const published = await processJob(db, data as Job, now)
  if (published) return { status: "published" as const }
  const { data: row } = await db.from("zone_month_editions").select("error_code").eq("zone", zone).eq("month", month).maybeSingle()
  return { status: "failed" as const, code: row?.error_code ?? null }
}

/** Arma el material, llama a Gemini y cierra la edición. Devuelve si se publicó. */
async function processJob(db: AdminDb, job: Job, now: Date) {
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
  return edition !== null
}
