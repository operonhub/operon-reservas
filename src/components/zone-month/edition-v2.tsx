import Link from "next/link"
import { CalendarDays, CalendarRange, ExternalLink, Lightbulb, MapPin, MessageCircle, Route, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/format"
import { CALENDAR_KINDS, MESSAGE_PLACEHOLDERS, monthLabel, type EditionV2, type Source } from "@/lib/zone-month/content"
import type { PropertyMonth } from "@/lib/zone-month/your-property"
import { RateDialog } from "@/components/rates/rate-dialog"
import { SlideDeck } from "./slide-deck"
import { CopyMessage, IdeaDone, InterestPicker } from "./zone-interactions"

const SCOPE_NOTE = {
  localidad: null,
  departamento: "Del pueblo había poca información publicada: parte de este informe mira el departamento o partido.",
  provincia: "Del pueblo y del departamento había poca información publicada: parte de este informe mira la provincia.",
} as const

function day(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"))
}
function weekday(value: string) {
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"))
}
function dateRange(start: string, end: string) {
  return start === end ? `${weekday(start)} ${day(start)}` : `${weekday(start)} ${day(start)} al ${weekday(end)} ${day(end)}`
}
/** Noches [start, end): la salida es el día `end`. */
function stayLabel(start: string, end: string, nights: number) {
  return `${day(start)} → ${day(end)} · ${nights} ${nights === 1 ? "noche" : "noches"}`
}
/** Última noche de una estadía [start, end): la "fecha hasta" de una tarifa. */
function lastNight(end: string) {
  return new Date(Date.parse(end + "T00:00:00Z") - 86400000).toISOString().slice(0, 10)
}
function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return url }
}

function Sources({ ids, sources, className }: { ids: number[]; sources: Source[]; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="label-mono">Fuente</span>
      {ids.slice(0, 3).map(i => sources[i] && (
        <a key={i} href={sources[i].url} target="_blank" rel="noopener noreferrer" title={sources[i].title}
          className="inline-flex max-w-full items-center gap-1 break-all font-medium text-primary underline underline-offset-4">
          {host(sources[i].url)}<ExternalLink className="size-3 shrink-0" />
        </a>
      ))}
    </p>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 rounded-2xl border bg-card/95 p-6 leading-relaxed">{children}</p>
}

export function EditionV2Slides({ edition, property, feedback, organizationName, publicUrl, canEditRates }: {
  edition: EditionV2
  property: PropertyMonth | null
  feedback: { interests: string[]; done: string[] }
  organizationName: string
  publicUrl: string
  canEditRates: boolean
}) {
  const month = monthLabel(edition.month)
  const monthName = month.split(" ")[0]
  const place = edition.place.locality
  const country = edition.zone.split(":")[0]
  const eventTitle = new Map(edition.events.map(e => [e.id, e.title]))
  const fill = (text: string) => text
    .replaceAll(MESSAGE_PLACEHOLDERS.name, organizationName)
    .replaceAll(MESSAGE_PLACEHOLDERS.link, publicUrl)
  const where = [edition.place.department, edition.place.province].filter(Boolean).join(", ")

  const panorama = (
    <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,.65fr)]">
      <div className="rounded-2xl border bg-card/95 p-6 shadow-sm sm:p-8">
        <p className="font-heading text-2xl leading-snug font-semibold text-balance sm:text-3xl">{edition.headline}</p>
        <div className="mt-5 space-y-4 leading-relaxed">{edition.overview.map(p => <p key={p}>{p}</p>)}</div>
      </div>
      <aside className="self-start space-y-3">
        <div className="rounded-2xl border border-primary/20 bg-primary/10 p-5">
          <p className="label-mono text-primary">En este informe</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><strong>{edition.events.length}</strong> {edition.events.length === 1 ? "evento" : "eventos"} con fecha</li>
            <li><strong>{edition.calendar.length}</strong> {edition.calendar.length === 1 ? "fecha clave" : "fechas clave"} (feriados, vacaciones)</li>
            <li><strong>{edition.practical.length}</strong> {edition.practical.length === 1 ? "dato práctico" : "datos prácticos"}</li>
            <li><strong>{edition.sources.length}</strong> fuentes consultadas</li>
          </ul>
        </div>
        {where && <p className="flex items-start gap-2 rounded-2xl border bg-card/95 p-4 text-sm"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" />{place} · {where}</p>}
        {SCOPE_NOTE[edition.place.scope] && <p className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm leading-relaxed">{SCOPE_NOTE[edition.place.scope]}</p>}
      </aside>
    </div>
  )

  const agenda = edition.events.length ? (
    <div className="mt-8 space-y-3">
      {edition.events.map(e => (
        <div key={e.id} className="grid gap-4 rounded-2xl border bg-card/95 p-5 shadow-sm sm:grid-cols-[8rem_1fr] sm:p-6">
          <div className="flex items-start gap-2 text-primary sm:flex-col">
            <CalendarDays className="size-5" />
            <time dateTime={e.start} className="font-heading text-xl leading-tight font-semibold">{day(e.start)}</time>
            {e.end !== e.start && <span className="text-xs text-muted-foreground">al {day(e.end)}</span>}
          </div>
          <div className="min-w-0">
            {e.place && <p className="label-mono text-muted-foreground">{e.place}</p>}
            <h3 className="mt-1 font-heading text-xl font-semibold">{e.title}</h3>
            <p className="mt-2 text-sm leading-relaxed">{e.summary}</p>
            <p className="mt-3 rounded-xl bg-primary/10 p-3 text-sm leading-relaxed"><strong>Para tu alojamiento:</strong> {e.forHosts}</p>
            <Sources ids={e.sources} sources={edition.sources} className="mt-3" />
          </div>
        </div>
      ))}
    </div>
  ) : <Empty>No encontramos agenda publicada para {place} en {monthName}. Si sabés de algún evento, contanos y lo sumamos a la próxima edición.</Empty>

  const calendar = edition.calendar.length ? (
    <div className="mt-8 grid gap-3 md:grid-cols-2">
      {edition.calendar.map(c => (
        <div key={c.title + c.start} className={cn("rounded-2xl border p-5 sm:p-6", c.kind === "finde_largo" || c.kind === "feriado" ? "border-warning/40 bg-warning/10" : "bg-card/95")}>
          <p className="label-mono text-muted-foreground">{CALENDAR_KINDS[c.kind]}</p>
          <h3 className="mt-2 font-heading text-lg font-semibold">{c.title}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-primary"><CalendarRange className="size-4" />{dateRange(c.start, c.end)}</p>
          <p className="mt-3 text-sm leading-relaxed">{c.summary}</p>
          <Sources ids={c.sources} sources={edition.sources} className="mt-3" />
        </div>
      ))}
    </div>
  ) : <Empty>No encontramos feriados ni vacaciones que caigan en {monthName}.</Empty>

  const occupancy = property && property.nightsTotal > 0 ? Math.round((property.nightsBooked / property.nightsTotal) * 100) : null
  const yours = !property || property.totalUnits === 0 ? (
    <Empty>Cuando cargues tus unidades y reservas, acá vas a ver cuántas tenés libres en cada fecha clave del mes y cuánto cobrás esos días. <Link href="/unidades" className="font-medium text-primary underline underline-offset-4">Ir a Unidades</Link></Empty>
  ) : (
    <div className="mt-8 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card/95 p-5">
          <p className="label-mono text-muted-foreground">Ocupación de {monthName}</p>
          <p className="mt-2 font-heading text-3xl font-semibold">{occupancy}%</p>
          <p className="mt-1 text-xs text-muted-foreground">{property.nightsBooked} de {property.nightsTotal} noches ocupadas o bloqueadas</p>
        </div>
        <div className="rounded-2xl border bg-card/95 p-5">
          <p className="label-mono text-muted-foreground">Noches libres</p>
          <p className="mt-2 font-heading text-3xl font-semibold">{property.nightsTotal - property.nightsBooked}</p>
          <p className="mt-1 text-xs text-muted-foreground">en {property.totalUnits} {property.totalUnits === 1 ? "unidad" : "unidades"}</p>
        </div>
        <div className={cn("rounded-2xl border p-5", property.pendingDeposit ? "border-warning/40 bg-warning/10" : "bg-card/95")}>
          <p className="label-mono text-muted-foreground">Reservas sin seña</p>
          <p className="mt-2 font-heading text-3xl font-semibold">{property.pendingDeposit}</p>
          {property.pendingDeposit > 0 && <Link href="/reservas?f=pendientes" className="mt-1 inline-block text-xs font-medium text-primary underline underline-offset-4">Ver pendientes</Link>}
        </div>
      </div>
      {property.keyDates.length > 0 ? (
        <ul className="space-y-3">
          {property.keyDates.map(k => {
            const same = k.nightly !== null && k.normalNightly !== null && k.nightly <= k.normalNightly
            return (
              <li key={k.key} className="rounded-2xl border bg-card/95 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="label-mono text-muted-foreground">{k.label} · {stayLabel(k.start, k.end, k.nights)}</p>
                    <h3 className="mt-1 font-heading text-lg font-semibold">{k.title}</h3>
                  </div>
                  <span className={cn("label-mono rounded-full px-3 py-1.5", k.freeUnits.length ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                    {k.freeUnits.length ? `${k.freeUnits.length} de ${k.totalUnits} libres` : "Completo"}
                  </span>
                </div>
                {k.freeUnits.length > 0 && <p className="mt-2 text-sm text-muted-foreground">Libres: {k.freeUnits.join(", ")}</p>}
                {k.nightly !== null && (
                  <p className="mt-3 text-sm leading-relaxed">
                    Cobrás <strong>{formatCurrency(k.nightly, property.currency)}</strong> por noche
                    {k.normalNightly !== null && <> · un martes normal, {formatCurrency(k.normalNightly, property.currency)}</>}.
                    {same && !k.specialRate && k.freeUnits.length > 0 && " Es una fecha con más demanda y cobrás lo mismo que un día común."}
                  </p>
                )}
                {same && !k.specialRate && k.freeUnits.length > 0 && canEditRates && property.propertyId && (
                  <div className="mt-4">
                    <RateDialog mode="new" units={property.unitsForRates} propertyId={property.propertyId} defaultPreset="temporada"
                      defaults={{ label: k.title.slice(0, 60), start_date: k.start, end_date: lastNight(k.end), min_nights: Math.min(k.nights, 2) }}
                      triggerLabel="Crear tarifa para esas fechas" triggerSize="sm" />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : <Empty>Este mes no hay fechas clave con día exacto para cruzar con tu calendario.</Empty>}
    </div>
  )

  const ideas = (
    <div className="mt-8 space-y-6">
      <ol className="grid gap-3 md:grid-cols-2">
        {edition.ideas.map((idea, i) => (
          <li key={idea.title} className="rounded-2xl border bg-card/95 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/20 text-warning"><Lightbulb className="size-5" /></span>
              <div className="min-w-0">
                <h3 className="font-heading text-lg font-semibold">{idea.title}</h3>
                {idea.eventId && eventTitle.get(idea.eventId) && <p className="label-mono mt-1 text-muted-foreground">Para: {eventTitle.get(idea.eventId)}</p>}
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed">{idea.text}</p>
            <div className="mt-4"><IdeaDone month={edition.month} id={`idea-${i}`} initialDone={feedback.done} /></div>
          </li>
        ))}
      </ol>
      {edition.messages.length > 0 && (
        <div>
          <p className="label-mono text-primary">Mensajes listos para mandar</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {edition.messages.map(m => (
              <div key={m.text} className="flex flex-col rounded-2xl border border-success/30 bg-success/10 p-5">
                <p className="label-mono flex items-center gap-1.5 text-success"><MessageCircle className="size-4" />{m.channel === "instagram" ? "Instagram" : "WhatsApp"}{m.eventId && eventTitle.get(m.eventId) ? ` · ${eventTitle.get(m.eventId)}` : ""}</p>
                <p className="mt-3 flex-1 text-sm leading-relaxed whitespace-pre-line">{fill(m.text)}</p>
                <div className="mt-4"><CopyMessage text={fill(m.text)} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const practical = (
    <div className="mt-8 space-y-6">
      {edition.practical.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {edition.practical.map(p => (
            <div key={p.title} className="rounded-2xl border bg-card/95 p-5 sm:p-6">
              <p className="flex items-center gap-2 font-heading text-lg font-semibold"><Route className="size-5 text-primary" />{p.title}</p>
              <p className="mt-3 text-sm leading-relaxed">{p.text}</p>
              <Sources ids={p.sources} sources={edition.sources} className="mt-3" />
            </div>
          ))}
        </div>
      ) : <p className="rounded-2xl border bg-card/95 p-6">No encontramos novedades de rutas, obras o servicios para este mes.</p>}
      <details className="rounded-2xl border bg-card/95 p-5">
        <summary className="cursor-pointer font-heading font-semibold">Todas las fuentes ({edition.sources.length})</summary>
        <ol className="mt-3 space-y-1.5 text-sm">
          {edition.sources.map(s => (
            <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-4">{s.title}</a> <span className="text-muted-foreground">· {host(s.url)}</span></li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">Investigado el {edition.collectedAt.slice(0, 10)} con búsquedas web. Antes de anunciar un evento, confirmá la fecha en la fuente.</p>
      </details>
    </div>
  )

  const next = (
    <div className="mt-8 rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8">
      <Sparkles className="size-7" />
      <p className="mt-4 font-heading text-xl leading-relaxed font-medium sm:text-2xl">¿Qué te gustaría profundizar el mes que viene?</p>
      <p className="mt-2 text-sm opacity-80">Elegí uno o más temas: la próxima edición de {place} se enfoca en lo que piden los alojamientos de la zona.</p>
      <div className="mt-5"><InterestPicker month={edition.month} initial={feedback.interests} /></div>
    </div>
  )

  return (
    <SlideDeck place={place} country={country} month={month} subtitle="investigado para los alojamientos de la zona" chapters={[
      { short: "Panorama", title: `Qué te espera en ${monthName}`, content: panorama },
      { short: "Agenda", title: "Agenda del mes", content: agenda },
      { short: "Fechas", title: "Fechas que mueven turismo", content: calendar },
      { short: "Tu complejo", title: `Tu complejo en ${monthName}`, content: yours },
      { short: "Ideas", title: "Ideas y mensajes listos", content: ideas },
      { short: "Práctico", title: "Info práctica y fuentes", content: practical },
      { short: "Próximo mes", title: "La próxima edición", content: next },
    ]} />
  )
}
