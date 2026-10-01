import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Json } from "@/lib/supabase/types"
import { ERRORS, INTERESTS, type EditionV2, type InterestId } from "./content"
import { collectMaterial, GenerationError, targetMonth } from "./validation"
import { researchModel, researchZone, type ResearchInput } from "@/lib/zone-month/research"
import { cordobaEvents } from "./cordoba-feed"
import defaultPack from "./sources.json"

type Job = { zone: string; month: string; lease: string }
type AdminDb = ReturnType<typeof createAdminClient>

/**
 * Pueblos por ejecución del cron. Cada investigación tarda 1-2 minutos y
 * corren en paralelo dentro del límite de la función (maxDuration 300 s):
 * con el tope de 10 zonas y 5 días de ventana sobran oportunidades.
 */
export const JOBS_PER_RUN = 4

/**
 * Cron diario: genera la edición del mes siguiente en los últimos cinco días
 * UTC. Las zonas salen de la base (clientes habilitados desde /operon, 0034),
 * no del entorno.
 */
export async function runZoneMonth(now = new Date()) {
  if (!targetMonth(now)) return { processed: 0, published: 0, failed: 0, outsideWindow: true }
  const db = createAdminClient()
  const jobs: Job[] = []
  for (let i = 0; i < JOBS_PER_RUN; i++) {
    const { data, error } = await db.rpc("zone_month_claim_enabled")
    if (error) throw new Error("database")
    if (!data) break
    jobs.push(data as Job)
  }
  const results = await Promise.allSettled(jobs.map(job => processJob(db, job, now)))
  // Un error de base en cualquier trabajo corta la corrida: el lease queda para recuperación.
  const broken = results.find((r): r is PromiseRejectedResult => r.status === "rejected")
  if (broken) throw broken.reason
  const published = results.filter(r => r.status === "fulfilled" && r.value).length
  return { processed: jobs.length, published, failed: jobs.length - published, outsideWindow: false }
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

/** Provincia y departamento oficiales de la zona (0036), si algún alojamiento los tiene. */
async function zonePlace(db: AdminDb, zone: string): Promise<ResearchInput["place"]> {
  const [country, city] = [zone.slice(0, 2), zone.slice(3)]
  const { data } = await db.from("properties")
    .select("city, province_name, department_name")
    .eq("country", country).ilike("city", city).eq("is_active", true)
    .order("located_at", { ascending: false, nullsFirst: false }).limit(1)
  const row = data?.[0]
  const name = row?.city?.trim() || city.replace(/(^|\s)\S/g, part => part.toLocaleUpperCase("es-AR"))
  return { locality: name, department: row?.department_name ?? null, province: row?.province_name ?? null }
}

/** Qué pidieron profundizar los dueños de la zona en la edición anterior (solo cuentas). */
async function zoneInterests(db: AdminDb, zone: string, month: string): Promise<ResearchInput["interests"]> {
  const { data, error } = await db.rpc("zone_month_interests", { p_zone: zone, p_month: month })
  if (error || !data || typeof data !== "object") return {}
  const counts: Partial<Record<InterestId, number>> = {}
  for (const [id, n] of Object.entries(data as Record<string, unknown>)) {
    if (Object.hasOwn(INTERESTS, id) && Number.isInteger(n) && (n as number) > 0) counts[id as InterestId] = n as number
  }
  return counts
}

/** Arma el material, investiga con Claude y cierra la edición. Devuelve si se publicó. */
async function processJob(db: AdminDb, job: Job, now: Date) {
  let edition: EditionV2 | null = null
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
    const model = researchModel()
    // Evidencia curada guardada antes de llamar a la IA, como en v1.
    const saved = await db.rpc("zone_month_material", { p_zone: job.zone, p_month: job.month, p_lease: job.lease, p_material: material as unknown as Json, p_model: model })
    if (saved.error || !saved.data) throw new Error("database")

    const input: ResearchInput = {
      zone: job.zone, month: job.month,
      place: await zonePlace(db, job.zone),
      facts: material.facts,
      interests: await zoneInterests(db, job.zone, job.month),
      today: now.toISOString().slice(0, 10),
    }
    const result = await researchZone(input, now)
    edition = result.edition
    // Dossier, fuentes y consumo real: para auditar el contenido y medir el costo.
    const evidence = {
      version: 2, collectedAt: now.toISOString(), facts: material.facts, warnings: material.warnings,
      dossier: result.dossier.text.slice(0, 60000), sources: result.dossier.sources, usage: result.usage,
    }
    const kept = await db.rpc("zone_month_material", { p_zone: job.zone, p_month: job.month, p_lease: job.lease, p_material: evidence as unknown as Json, p_model: result.model })
    if (kept.error || !kept.data) throw new Error("database")
  } catch (error) {
    if (!(error instanceof GenerationError)) throw error
    code = Object.hasOwn(ERRORS, error.code) ? error.code : "provider"
    edition = null
  }
  const finished = await db.rpc("zone_month_finish", {
    p_zone: job.zone, p_month: job.month, p_lease: job.lease,
    p_edition: edition as unknown as Json | null, p_error: code,
  })
  if (finished.error || !finished.data) throw new Error("database")
  return edition !== null
}
