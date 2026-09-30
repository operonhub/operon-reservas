import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { requireContext } from "@/lib/auth"
import { canManageSettings } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"
import { ZONE_MONTH_LABEL, ERRORS, monthLabel } from "@/lib/zone-month/content"
import { targetMonth, validateEdition, zoneKey } from "@/lib/zone-month/validation"
import { validateEditionV2 } from "@/lib/zone-month/edition-v2"
import { propertyMonth } from "@/lib/zone-month/your-property"
import { publicReservationUrl } from "@/lib/site-url"
import { EditionSlides } from "@/components/zone-month/edition-slides"
import { EditionV2Slides } from "@/components/zone-month/edition-v2"
import { isZoneMonthEnabled } from "@/lib/zone-month/flag"

export const dynamic = "force-dynamic"
export async function generateMetadata() {
  if (!isZoneMonthEnabled()) return {}
  return (await requireContext()).zoneMonthEnabled ? { title: ZONE_MONTH_LABEL } : {}
}

function processingWasInterrupted(startedAt: string | null | undefined) {
  return Boolean(startedAt && Date.now() - Date.parse(startedAt) > 5 * 60000)
}

function zoneLabel(zone: string) {
  const [country, city = ""] = zone.split(":")
  const name = city.replace(/(^|\s)\S/g, part => part.toLocaleUpperCase("es-AR"))
  return name + " · " + country
}

export default async function ZoneMonthPage({ searchParams }: { searchParams: Promise<{ zone?: string; month?: string }> }) {
  if (!isZoneMonthEnabled()) notFound()
  const ctx = await requireContext()
  // Operon la activa por cliente desde el panel interno.
  if (!ctx.zoneMonthEnabled) notFound()
  const params = await searchParams
  const header = <header className="relative mb-8 overflow-hidden rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
    <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-primary/15 blur-3xl" />
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-28 size-56 rounded-full bg-warning/15 blur-3xl" />
    <div className="relative">
      <p className="label-mono text-primary">Operon Reservas · {ctx.organizationName}</p>
      <h1 className="mt-3 max-w-2xl font-heading text-4xl leading-[1.04] font-semibold text-balance sm:text-5xl">{ZONE_MONTH_LABEL}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">Qué va a pasar en tu destino el mes que viene y qué significa para tu complejo. Se investiga en los últimos días de cada mes y aparece cuando está lista.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <span className="label-mono rounded-full bg-primary/10 px-3 py-1.5 text-primary">Investigado en la web</span>
        <span className="label-mono rounded-full bg-warning/15 px-3 py-1.5 text-foreground">Cada dato con su fuente</span>
      </div>
    </div>
  </header>
  const wrap = (body: React.ReactNode) => <div className="mx-auto w-full max-w-6xl p-4 pb-12 sm:p-6 lg:p-8">{header}{body}</div>
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
  let editionV2 = null
  let invalid = false
  if (selected?.status === "published") {
    try {
      const version = (selected.edition as { version?: unknown } | null)?.version
      if (version === 2) editionV2 = validateEditionV2(selected.edition, zone, selected.month)
      else edition = validateEdition(selected.edition, zone, selected.month)
    } catch { invalid = true }
  }
  // Lo de este complejo (sin IA) y lo que ya contestó en esta edición.
  const [property, feedbackRow, publicUrl] = editionV2 ? await Promise.all([
    propertyMonth(db, ctx.organizationId, editionV2).catch(() => null),
    db.from("zone_month_feedback").select("interests, done").eq("organization_id", ctx.organizationId).eq("month", editionV2.month).maybeSingle().then(r => r.data),
    publicReservationUrl(ctx.organizationSlug),
  ]) : [null, null, ""]
  const available = edition || editionV2
  const collectedAt = editionV2?.collectedAt ?? edition?.material.collectedAt ?? ""
  const stale = selected?.status === "processing" && processingWasInterrupted(selected.started_at)
  return wrap(<>
    {missing && configure}
    <div className="mb-6 flex flex-wrap gap-2" aria-label="Zonas disponibles">{zones.map(z => <Link key={z} href={`/tu-zona?zone=${encodeURIComponent(z)}`} aria-current={zone === z ? "page" : undefined} className={`rounded-full border px-4 py-2 text-sm ${zone === z ? "bg-primary text-primary-foreground" : ""}`}>{zoneLabel(z)}</Link>)}</div>
    <div className="mb-6 rounded-2xl border border-primary/20 bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-mono text-primary">Estado de la edición</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold">{selected ? monthLabel(selected.month) : monthLabel(waitingMonth)}</h2>
        </div>
        {available && <span className="label-mono rounded-full bg-success/15 px-3 py-1.5 text-success">Disponible</span>}
      </div>
      {available ? <p className="mt-2 text-sm text-muted-foreground">Disponible desde {selected?.published_at?.slice(0, 10)} · Investigado el {collectedAt.slice(0, 10)}. {editionV2 ? "Cada evento, fecha y dato práctico enlaza a la fuente de donde salió." : "Edición anterior: prácticas de un catálogo editorial y fechas de fuentes oficiales."}</p> : <p role="status" className="mt-2 text-sm">{invalid ? "La edición guardada no pasó la validación y no se puede mostrar." : params.month && !selected ? "La edición solicitada no está disponible para esta zona." : stale ? "La generación se interrumpió. Se recuperará automáticamente dentro de la ventana de reintentos, si quedan intentos." : selected?.status === "failed" ? `${ERRORS[selected.error_code || ""] || "No se pudo completar la edición."} ${selected.attempts >= 3 ? "Se agotaron los tres intentos automáticos de esta edición." : "Se reintentará automáticamente dentro de la ventana mensual."}` : selected?.status === "processing" ? "La edición se está preparando." : process.env.ZONE_MONTH_ENABLED !== "1" ? "La generación automática todavía no está activada." : "Todavía no hay una edición lista. La preparación es automática; no tenés que solicitarla."}</p>}
    </div>
    {edition && <EditionSlides edition={edition} />}
    {editionV2 && <EditionV2Slides edition={editionV2} property={property} feedback={{ interests: feedbackRow?.interests ?? [], done: feedbackRow?.done ?? [] }}
      organizationName={ctx.organizationName} publicUrl={publicUrl} canEditRates={canManageSettings(ctx.role)} />}
    {reports.length > 0 && <details className="mt-6 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"><summary className="cursor-pointer font-heading font-semibold">Archivo de ediciones</summary><ul className="mt-3 space-y-2">{reports.map(r => <li key={r.month}><Link className="underline" href={`/tu-zona?zone=${encodeURIComponent(zone)}&month=${r.month}`}>{monthLabel(r.month)}</Link><span className="ml-2 text-sm text-muted-foreground">{r.status === "published" ? "Disponible" : r.status === "failed" ? "No publicada" : "En preparación"}</span></li>)}</ul></details>}
  </>)
}
