"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, MapPinned, Maximize2, X } from "lucide-react"
import { cn } from "@/lib/utils"

export type Chapter = { short: string; title: string; content: ReactNode }

const SLIDE_COLORS = [
  "from-primary/15 via-card to-card",
  "from-warning/20 via-card to-card",
  "from-primary/10 via-card to-accent/30",
  "from-success/15 via-card to-card",
  "from-warning/15 via-card to-primary/10",
  "from-primary/10 via-card to-card",
  "from-success/10 via-card to-warning/10",
]

/**
 * Marco de "Tu zona este mes": una diapositiva a la vez, índice, flechas del
 * teclado y modo presentación a pantalla completa (con salida visible, Escape
 * y foco atrapado). El contenido de cada capítulo lo arma quien lo usa.
 */
export function SlideDeck({ place, country, month, subtitle, chapters }: {
  place: string
  country: string
  month: string
  subtitle: string
  chapters: Chapter[]
}) {
  const [active, setActive] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const shellRef = useRef<HTMLElement>(null)
  const launchRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const enteredFullscreen = useRef(false)
  const restoreLaunchFocus = useCallback(() => launchRef.current?.focus(), [])
  const count = chapters.length

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
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role=dialog]"))) return
      const next = event.key === "ArrowRight" || (presenting && (event.key === "PageDown" || event.key === " "))
      const previous = event.key === "ArrowLeft" || (presenting && event.key === "PageUp")
      if (!next && !previous) return
      if (event.key === " " && target instanceof HTMLElement && target.closest("button, a[href]")) return
      event.preventDefault()
      setActive(current => Math.max(0, Math.min(count - 1, current + (next ? 1 : -1))))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [presenting, closePresentation, count])

  const chapter = chapters[active]
  const number = (i: number) => String(i + 1).padStart(2, "0")

  return (
    <section
      ref={shellRef}
      role={presenting ? "dialog" : undefined}
      aria-modal={presenting || undefined}
      aria-label={presenting ? "Presentación de " + place + ", " + month : undefined}
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
            <p className="truncate font-heading text-lg font-semibold">{place} <span className="font-normal text-muted-foreground">· {country}</span></p>
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

      <nav aria-label="Capítulos de la edición" className="relative z-10 grid shrink-0 gap-1.5 border-b bg-card px-3 py-3 sm:gap-2 sm:px-6"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {chapters.map((c, index) => (
          <button key={c.title} type="button" onClick={() => setActive(index)} aria-label={number(index) + ". " + c.title} aria-current={active === index ? "step" : undefined}
            className={cn(
              "min-w-0 rounded-lg px-1 py-2 text-center text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring lg:flex lg:items-center lg:justify-center lg:gap-2 lg:px-2",
              active === index ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}>
            <span className="font-mono">{number(index)}</span><span className="hidden truncate lg:inline">{c.short}</span>
          </button>
        ))}
      </nav>

      <article aria-label={"Diapositiva " + (active + 1) + " de " + count + ": " + chapter.title}
        className={cn(
          "relative bg-linear-to-br",
          SLIDE_COLORS[active % SLIDE_COLORS.length],
          presenting ? "min-h-0 flex-1 overflow-y-auto" : "min-h-[440px]",
        )}>
        <span aria-hidden="true" className="pointer-events-none absolute -right-4 top-0 font-heading text-[clamp(8rem,25vw,18rem)] leading-none font-bold text-primary/5">{number(active)}</span>
        <div className="relative mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <p className="label-mono text-primary">Capítulo {number(active)} / {number(count - 1)} · {place}</p>
          <h2 className="mt-3 max-w-3xl font-heading text-[clamp(1.8rem,4vw,3.25rem)] leading-[1.05] font-semibold text-balance">{chapter.title}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{month} · {subtitle}</p>
          {chapter.content}
        </div>
      </article>

      <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-t bg-card px-4 py-4 sm:px-6" aria-label="Controles de presentación">
        <button type="button" disabled={active === 0} onClick={() => setActive(current => current - 1)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring sm:px-4"><ArrowLeft className="size-4" /> Anterior</button>
        <span className="label-mono text-center text-muted-foreground" aria-live="polite">{active + 1} / {count}</span>
        <button type="button" disabled={active === count - 1} onClick={() => setActive(current => current + 1)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring sm:px-4">Siguiente <ArrowRight className="size-4" /></button>
      </div>
    </section>
  )
}
