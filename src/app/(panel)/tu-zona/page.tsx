import Link from "next/link"
import { cookies } from "next/headers"
import { requireContext } from "@/lib/auth"
import { canManageSettings } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"
import { ZONE_MONTH_LABEL, ERRORS, monthLabel } from "@/lib/zone-month/content"
import { targetMonth, validateEdition, zoneKey } from "@/lib/zone-month/validation"
import { EditionSlides } from "@/components/zone-month/edition-slides"

export const dynamic = "force-dynamic"
export const metadata = { title: ZONE_MONTH_LABEL }

function processingWasInterrupted(startedAt: string | null | undefined) {
  return Boolean(startedAt && Date.now() - Date.parse(startedAt) > 5 * 60000)
}

export default async function ZoneMonthPage({ searchParams }: { searchParams: Promise<{ zone?: string; month?: string }> }) {
  const ctx = await requireContext()
  const params = await searchParams
  const header = <header className="mb-8"><p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Una mirada compartida al destino</p><h1 className="text-3xl font-semibold tracking-tight">{ZONE_MONTH_LABEL}</h1><p className="mt-3 max-w-2xl text-muted-foreground">Una edición mensual para todos los alojamientos de la zona. Se prepara automáticamente en la última semana del mes anterior y aparece cuando está lista.</p></header>
  const wrap = (body: React.ReactNode) => <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-8">{header}{body}</div>
  if ((await cookies()).get("operon_demo")?.value === "1") return wrap(<p role="status" className="rounded-xl border p-6">Esta sección no genera ediciones en el recorrido demo. No hay una ejecución de IA ni una edición real para mostrar.</p>)
  const db = await createClient()
  const { data: properties, error: locationError } = await db.from("properties").select("city,country").eq("organization_id", ctx.organizationId).eq("is_active", true)
  if (locationError) return wrap(<p role="status">No pudimos consultar la localización. Volvé a intentar más tarde.</p>)
  const zones = [...new Set((properties || []).map(p => zoneKey(p.country, p.city)).filter((z): z is string => Boolean(z)))]
  const missing = !properties?.length || properties.some(p => !zoneKey(p.country, p.city))
  const configure = <div role="status" className="mb-6 rounded-xl border p-5"><p>Falta una ciudad y un país válidos en la localización del alojamiento.</p>{canManageSettings(ctx.role) ? <p className="mt-2"><Link className="underline" href="/configuracion">Revisar la ciudad en Configuración</Link>. Si falta el país, contactá a soporte.</p> : <p className="mt-2">Pedile al dueño o a un administrador que revise la localización.</p>}</div>
  if (!zones.length) return wrap(configure)
  const zone = zones.includes(params.zone || "") ? params.zone! : zones[0]
  const { data: rows, error } = await db.from("zone_month_editions")
    .select("zone,month,status,attempts,started_at,error_code,edition,published_at")
    .eq("zone", zone).order("month", { ascending: false }).limit(60)
  if (error) return wrap(<p role="status">No pudimos consultar las ediciones. La función puede estar pendiente de configuración; volvé a intentar más tarde.</p>)
  const reports = rows || []
  const waitingMonth = targetMonth(new Date()) || new Date().toISOString().slice(0, 7) + "-01"
  const selected = reports.find(r => r.month === (params.month || waitingMonth))
  let edition = null
  let invalid = false
  if (selected?.status === "published") {
    try { edition = validateEdition(selected.edition, zone, selected.month) } catch { invalid = true }
  }
  const stale = selected?.status === "processing" && processingWasInterrupted(selected.started_at)
  return wrap(<>
    {missing && configure}
    <div className="mb-6 flex flex-wrap gap-2" aria-label="Zonas disponibles">{zones.map(z => <Link key={z} href={`/tu-zona?zone=${encodeURIComponent(z)}`} aria-current={zone === z ? "page" : undefined} className={`rounded-full border px-4 py-2 text-sm ${zone === z ? "bg-primary text-primary-foreground" : ""}`}>{z.split(":")[1]} · {z.split(":")[0]}</Link>)}</div>
    <div className="mb-6 rounded-xl border p-5">
      <h2 className="font-semibold">{selected ? monthLabel(selected.month) : monthLabel(waitingMonth)}</h2>
      {edition ? <p className="mt-2 text-sm text-muted-foreground">Disponible desde {selected?.published_at?.slice(0, 10)} · Fuentes recopiladas el {edition.material.collectedAt.slice(0, 10)}. Gemini priorizó prácticas de un catálogo editorial; los hechos provienen de las fuentes citadas.</p> : <p role="status" className="mt-2 text-sm">{invalid ? "La edición guardada no pasó la validación y no se puede mostrar." : params.month && !selected ? "La edición solicitada no está disponible para esta zona." : stale ? "La generación se interrumpió. Se recuperará automáticamente dentro de la ventana de reintentos, si quedan intentos." : selected?.status === "failed" ? `${ERRORS[selected.error_code || ""] || "No se pudo completar la edición."} ${selected.attempts >= 3 ? "Se agotaron los tres intentos automáticos de esta edición." : "Se reintentará automáticamente dentro de la ventana mensual."}` : selected?.status === "processing" ? "La edición se está preparando." : process.env.ZONE_MONTH_ENABLED !== "1" ? "La generación automática todavía no está activada." : "Todavía no hay una edición lista. La preparación es automática; no tenés que solicitarla."}</p>}
    </div>
    {reports.length > 0 && <details className="mb-8 rounded-xl border p-4"><summary className="cursor-pointer font-medium">Archivo de ediciones</summary><ul className="mt-3 space-y-2">{reports.map(r => <li key={r.month}><Link className="underline" href={`/tu-zona?zone=${encodeURIComponent(zone)}&month=${r.month}`}>{monthLabel(r.month)}</Link><span className="ml-2 text-sm text-muted-foreground">{r.status === "published" ? "Disponible" : r.status === "failed" ? "No publicada" : "En preparación"}</span></li>)}</ul></details>}
    {edition && <EditionSlides edition={edition} />}
  </>)
}
