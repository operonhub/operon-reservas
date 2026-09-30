import { CalendarDays, ExternalLink, Lightbulb } from "lucide-react"
import { cn } from "@/lib/utils"
import { CLOSING, PRACTICES, TITLES, monthLabel, type Edition } from "@/lib/zone-month/content"
import { SlideDeck } from "./slide-deck"

/** Edición v1 (catálogo de prácticas). Se conserva para mostrar las ya publicadas. */
const CHAPTERS = ["Panorama", "Oportunidad", "Comercial", "Operación", "Plan"]

function cityName(zone: string) {
  return zone.split(":").slice(1).join(":").replace(/(^|\s)\S/g, part => part.toLocaleUpperCase("es-AR"))
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(value + "T12:00:00Z"))
}

export function EditionSlides({ edition }: { edition: Edition }) {
  const { material, selection } = edition
  const commercial = PRACTICES[selection.commercial]
  const operational = PRACTICES[selection.operational]
  const facts = selection.factIds.map(id => material.facts.find(f => f.id === id)!)
  const city = cityName(edition.zone)
  const month = monthLabel(edition.month)
  const country = edition.zone.split(":")[0]
  const chapters = [
    { short: CHAPTERS[0], title: TITLES[0], content: (
            <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,.65fr)]">
              <div className="space-y-3">
                <p className="label-mono text-primary">Fechas con fuente pública</p>
                {facts.length ? facts.map(fact => (
                  <div key={fact.id} className="grid gap-4 rounded-2xl border bg-card/95 p-5 shadow-sm sm:grid-cols-[7rem_1fr] sm:p-6">
                    <div className="flex items-start gap-2 text-primary sm:flex-col">
                      <CalendarDays className="size-5" />
                      <time dateTime={fact.start} className="font-heading text-xl font-semibold leading-tight">{shortDate(fact.start)}</time>
                      {fact.end !== fact.start && <span className="text-xs text-muted-foreground">al {shortDate(fact.end)}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="label-mono text-muted-foreground">{fact.kind === "holiday" ? "Feriado nacional" : "Agenda local"}</p>
                      <h3 className="mt-1 font-heading text-xl font-semibold">{fact.title}</h3>
                      <p className="mt-3 text-sm leading-relaxed">Preparar información útil para quienes consideran viajar en estas fechas. No implica una previsión de reservas.</p>
                      <a href={fact.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex max-w-full items-center gap-1.5 break-all text-sm font-medium text-primary underline underline-offset-4">
                        {fact.publisher}<ExternalLink className="size-3.5 shrink-0" />
                      </a>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Publicación: {fact.published} · Consulta editorial: {fact.checked} · Vigente al recopilar hasta: {fact.validUntil}</p>
                    </div>
                  </div>
                )) : <p className="rounded-2xl border bg-card p-6">No hay fechas públicas corroboradas en este paquete.</p>}
              </div>
              <aside className="self-start rounded-2xl border border-warning/40 bg-warning/10 p-5 sm:p-6">
                <p className="label-mono text-warning">Lo que aún no sabemos</p>
                <h3 className="mt-2 font-heading text-xl font-semibold">Agenda local</h3>
                <div className="mt-4 space-y-3 text-sm leading-relaxed">{material.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>
              </aside>
            </div>
    ) },
    { short: CHAPTERS[1], title: TITLES[1], content: (
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-warning/40 bg-warning/15 p-6 sm:p-8">
                <Lightbulb className="size-7 text-warning" />
                <p className="label-mono mt-6 text-muted-foreground">Una oportunidad para observar</p>
                <p className="mt-2 font-heading text-xl leading-relaxed font-medium sm:text-2xl">{facts.length ? "Las fechas públicas permiten orientar información a quienes planifican una escapada." : "Sin agenda corroborada no hay base para afirmar tendencias de demanda."}</p>
                {facts.length > 0 && <p className="mt-4 text-sm text-muted-foreground">Es una oportunidad a explorar, no evidencia de mayor demanda.</p>}
              </div>
              <div className="rounded-2xl border bg-card/95 p-6 sm:p-8">
                <p className="label-mono text-primary">Una señal para empezar</p>
                <h3 className="mt-3 font-heading text-2xl font-semibold">{PRACTICES.interests.title}</h3>
                <p className="mt-4 leading-relaxed">{PRACTICES.interests.text}</p>
                <p className="mt-6 rounded-xl bg-primary/10 p-4 text-sm"><strong>Medir:</strong> {PRACTICES.interests.signal}.</p>
              </div>
            </div>
    ) },
    { short: CHAPTERS[2], title: TITLES[2], content: (
            <div className="mt-8 grid gap-4 md:grid-cols-[1.3fr_.7fr]">
              <div className="rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8">
                <p className="label-mono opacity-75">Práctica comercial elegida para esta edición</p>
                <h3 className="mt-5 font-heading text-2xl leading-tight font-semibold sm:text-3xl">{commercial.title}</h3>
                <p className="mt-5 max-w-xl text-base leading-relaxed sm:text-lg">{commercial.text}</p>
              </div>
              <div className="rounded-2xl border bg-card/95 p-6 sm:p-8">
                <p className="label-mono text-primary">Decidir con datos</p>
                <p className="mt-4 leading-relaxed">No se analizaron tarifas, ocupación ni resultados de ningún alojamiento.</p>
                <p className="mt-4 text-sm text-muted-foreground">No hay base para recomendar aumentos o bajas de precios.</p>
                <p className="mt-6 rounded-xl bg-primary/10 p-4 text-sm"><strong>Medir:</strong> {commercial.signal}.</p>
              </div>
            </div>
    ) },
    { short: CHAPTERS[3], title: TITLES[3], content: (
            <div className="mt-8 grid gap-4 md:grid-cols-[1.3fr_.7fr]">
              <div className="rounded-2xl border border-success/30 bg-success/10 p-6 sm:p-8">
                <p className="label-mono text-success">Práctica operativa elegida para esta edición</p>
                <h3 className="mt-5 font-heading text-2xl leading-tight font-semibold sm:text-3xl">{operational.title}</h3>
                <p className="mt-5 max-w-xl text-base leading-relaxed sm:text-lg">{operational.text}</p>
              </div>
              <div className="rounded-2xl bg-warning p-6 text-warning-foreground sm:p-8">
                <p className="label-mono opacity-70">Señal para seguir</p>
                <p className="mt-5 font-heading text-xl leading-relaxed font-semibold">{operational.signal}</p>
                <p className="mt-6 text-sm">Una práctica general para poner a prueba durante el mes.</p>
              </div>
            </div>
    ) },
    { short: CHAPTERS[4], title: TITLES[4], content: (
            <div className="mt-8">
              <ol className="grid gap-3 md:grid-cols-3">{selection.actions.map((id, index) => {
                const action = PRACTICES[id]
                return <li key={id} className={cn("rounded-2xl border p-5 sm:p-6", index === 0 ? "border-primary/30 bg-primary/10" : index === 1 ? "border-warning/40 bg-warning/10" : "border-success/30 bg-success/10")}>
                  <p className="label-mono text-muted-foreground">{index === 0 ? "Semana 1" : index === 1 ? "Semana 2" : "Semanas 3 y 4"} · Esfuerzo {action.effort}</p>
                  <span aria-hidden="true" className="mt-5 block font-heading text-5xl leading-none font-light text-primary/55">0{index + 1}</span>
                  <h3 className="mt-4 font-heading text-lg font-semibold">{action.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed">{action.text}</p>
                  <p className="mt-5 border-t pt-4 text-xs leading-relaxed text-muted-foreground"><strong>Medir:</strong> {action.signal}.</p>
                </li>
              })}</ol>
              <p className="mt-5 rounded-2xl bg-primary p-5 font-heading text-lg leading-relaxed font-medium text-primary-foreground sm:p-6 sm:text-xl">{CLOSING}</p>
            </div>
    ) },
  ]
  return <SlideDeck place={city} country={country} month={month} subtitle="una mirada compartida para la zona" chapters={chapters} />
}
