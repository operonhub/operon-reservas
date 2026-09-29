"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, CalendarDays, ExternalLink, Lightbulb, MapPinned, Maximize2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { CLOSING, PRACTICES, TITLES, monthLabel, type Edition } from "@/lib/zone-month/content"

const CHAPTERS = ["Panorama", "Oportunidad", "Comercial", "Operación", "Plan"]
const SLIDE_COLORS = [
  "from-primary/15 via-card to-card",
  "from-warning/20 via-card to-card",
  "from-primary/10 via-card to-accent/30",
  "from-success/15 via-card to-card",
  "from-warning/15 via-card to-primary/10",
]

function cityName(zone: string) {
  return zone.split(":").slice(1).join(":").replace(/(^|\s)\S/g, part => part.toLocaleUpperCase("es-AR"))
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(value + "T12:00:00Z"))
}

export function EditionSlides({ edition }: { edition: Edition }) {
  const [active, setActive] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const shellRef = useRef<HTMLElement>(null)
  const launchRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const enteredFullscreen = useRef(false)
  const restoreLaunchFocus = useCallback(() => launchRef.current?.focus(), [])

  const closePresentation = useCallback(() => {
    if (document.fullscreenElement === shellRef.current) void document.exitFullscreen().catch(() => {})
    enteredFullscreen.current = false
    setPresenting(false)
  }, [])

  function openPresentation() {
    setPresenting(true)
    // El overlay cubre la pantalla aunque el navegador no admita Fullscreen API.
    if (shellRef.current?.requestFullscreen) void shellRef.current.requestFullscreen().catch(() => {})
  }

  useEffect(() => {
    function onFullscreenChange() {
      if (document.fullscreenElement === shellRef.current) enteredFullscreen.current = true
      else if (enteredFullscreen.current) {
        enteredFullscreen.current = false
        setPresenting(false)
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  useEffect(() => {
    if (!presenting) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      requestAnimationFrame(restoreLaunchFocus)
    }
  }, [presenting, restoreLaunchFocus])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (presenting && event.key === "Escape") {
        event.preventDefault()
        closePresentation()
        return
      }
      if (presenting && event.key === "Tab") {
        const focusable = Array.from(shellRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") || [])
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        return
      }
      if (!presenting && !shellRef.current?.contains(document.activeElement)) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return
      const next = event.key === "ArrowRight" || (presenting && (event.key === "PageDown" || event.key === " "))
      const previous = event.key === "ArrowLeft" || (presenting && event.key === "PageUp")
      if (!next && !previous) return
      if (event.key === " " && target instanceof HTMLElement && target.closest("button, a[href]")) return
      event.preventDefault()
      setActive(current => Math.max(0, Math.min(TITLES.length - 1, current + (next ? 1 : -1))))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [presenting, closePresentation])

  const { material, selection } = edition
  const commercial = PRACTICES[selection.commercial]
  const operational = PRACTICES[selection.operational]
  const facts = selection.factIds.map(id => material.facts.find(f => f.id === id)!)
  const city = cityName(edition.zone)
  const month = monthLabel(edition.month)
  const country = edition.zone.split(":")[0]

  return (
    <section
      ref={shellRef}
      role={presenting ? "dialog" : undefined}
      aria-modal={presenting || undefined}
      aria-label={presenting ? "Presentación de " + city + ", " + month : undefined}
      className={cn(
        "relative isolate flex min-w-0 flex-col overflow-hidden border bg-card text-card-foreground shadow-sm",
        presenting ? "fixed inset-0 z-[100] h-dvh w-screen rounded-none border-0 bg-background text-foreground" : "rounded-3xl",
      )}
    >
      <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card/95 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><MapPinned className="size-5" /></span>
          <div className="min-w-0">
            <p className="label-mono text-primary">Edición mensual · {month}</p>
            <p className="truncate font-heading text-lg font-semibold">{city} <span className="font-normal text-muted-foreground">· {country}</span></p>
          </div>
        </div>
        {presenting ? (
          <button ref={closeRef} type="button" aria-label="Salir de presentación" onClick={closePresentation} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <X className="size-4" /><span className="hidden sm:inline">Salir</span>
          </button>
        ) : (
          <button ref={launchRef} type="button" onClick={openPresentation} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring">
            <Maximize2 className="size-4" /> Modo presentación
          </button>
        )}
      </div>

      <nav aria-label="Capítulos de la edición" className="relative z-10 grid shrink-0 grid-cols-5 gap-1.5 border-b bg-card px-3 py-3 sm:gap-2 sm:px-6">
        {TITLES.map((title, index) => (
          <button key={title} type="button" onClick={() => setActive(index)} aria-label={String(index + 1) + ". " + title} aria-current={active === index ? "step" : undefined}
            className={cn(
              "min-w-0 rounded-lg px-1 py-2 text-center text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring sm:flex sm:items-center sm:justify-center sm:gap-2 sm:px-2",
              active === index ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}>
            <span className="font-mono">0{index + 1}</span><span className="hidden truncate sm:inline">{CHAPTERS[index]}</span>
          </button>
        ))}
      </nav>

      <article aria-label={"Diapositiva " + (active + 1) + " de " + TITLES.length + ": " + TITLES[active]}
        className={cn(
          "relative bg-linear-to-br",
          SLIDE_COLORS[active],
          presenting ? "min-h-0 flex-1 overflow-y-auto" : "min-h-[440px]",
        )}>
        <span aria-hidden="true" className="pointer-events-none absolute -right-4 top-0 font-heading text-[clamp(8rem,25vw,18rem)] leading-none font-bold text-primary/5">0{active + 1}</span>
        <div className="relative mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <p className="label-mono text-primary">Capítulo 0{active + 1} / 0{TITLES.length} · {city}</p>
          <h2 className="mt-3 max-w-3xl font-heading text-[clamp(1.8rem,4vw,3.25rem)] leading-[1.05] font-semibold text-balance">{TITLES[active]}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{month} · una mirada compartida para la zona</p>

          {active === 0 && (
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
          )}

          {active === 1 && (
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
          )}

          {active === 2 && (
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
          )}

          {active === 3 && (
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
          )}

          {active === 4 && (
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
          )}
        </div>
      </article>

      <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-t bg-card px-4 py-4 sm:px-6" aria-label="Controles de presentación">
        <button type="button" disabled={active === 0} onClick={() => setActive(current => current - 1)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring sm:px-4"><ArrowLeft className="size-4" /> Anterior</button>
        <span className="label-mono text-center text-muted-foreground" aria-live="polite">{active + 1} / {TITLES.length}</span>
        <button type="button" disabled={active === TITLES.length - 1} onClick={() => setActive(current => current + 1)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring sm:px-4">Siguiente <ArrowRight className="size-4" /></button>
      </div>
    </section>
  )
}
