"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { markTourCompleted } from "@/app/(panel)/onboarding-actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TOUR_STEPS, type TourStep } from "./tour-steps"

const DEMO_KEY = "operon_tour_demo_v1"
const LAST = TOUR_STEPS.length - 1

const TourContext = React.createContext<{ start: () => void }>({ start: () => {} })
export const useTour = () => React.useContext(TourContext)

/* --------------------------- Anclas en la página --------------------------- */

function isVisible(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && element.getClientRects().length > 0
}

function resolveAnchor(step: TourStep): { element: HTMLElement; viaMenu: boolean } | null {
  const find = (key: string) =>
    Array.from(document.querySelectorAll(`[data-tour="${key}"]`)).find(isVisible) ?? null
  if (!step.anchor) return null
  const direct = find(step.anchor)
  if (direct) return { element: direct, viaMenu: false }
  const menu = step.mobileAnchor ? find(step.mobileAnchor) : null
  return menu ? { element: menu, viaMenu: true } : null
}

/* -------------------------------- Proveedor -------------------------------- */

const subscribeNothing = () => () => {}

function readDemoSeen() {
  try {
    return window.localStorage.getItem(DEMO_KEY) === "1"
  } catch {
    return true
  }
}

/**
 * Tour guiado del panel, sobre Inicio.
 *
 * El paso elegido vive en estado de React y la URL (`/?tour=N`) es solo un
 * espejo para que un refresco no lo pierda: desde un provider del layout,
 * `useSearchParams` no se entera de un `history.replaceState`, así que la URL
 * no puede ser la fuente de verdad.
 */
export function TourProvider({
  autoStart,
  isDemo,
  children,
}: {
  autoStart: boolean
  isDemo: boolean
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // En SSR e hidratación no hay overlay: un portal al <body> no coincidiría
  // con el HTML del servidor.
  const mounted = React.useSyncExternalStore(subscribeNothing, () => true, () => false)
  // En la demo el tour se recuerda por visitante; en el servidor se asume visto.
  const demoSeen = React.useSyncExternalStore(subscribeNothing, readDemoSeen, () => true)

  // undefined: el usuario todavía no tocó el tour, manda la URL o el arranque
  // automático. null: lo cerró.
  const [chosen, setChosen] = React.useState<number | null | undefined>(undefined)

  const onHome = pathname === "/"
  const fromWizard = onHome && searchParams.get("bienvenida") === "1"
  const raw = searchParams.get("tour")
  const fromUrl = raw !== null && /^\d+$/.test(raw) ? Math.min(Number(raw), LAST) : null
  const shouldAutoStart = fromWizard || (isDemo ? !demoSeen : autoStart)
  const automatic = fromUrl ?? (shouldAutoStart ? (fromWizard ? 0 : 1) : null)
  const index = onHome ? (chosen === undefined ? automatic : chosen) : null

  const show = React.useCallback((next: number | null) => {
    setChosen(next)
    const params = new URLSearchParams(window.location.search)
    params.delete("bienvenida")
    if (next === null) params.delete("tour")
    else params.set("tour", String(next))
    const query = params.toString()
    window.history.replaceState(window.history.state, "", query ? `/?${query}` : "/")
  }, [])

  const finish = React.useCallback(() => {
    show(null)
    if (isDemo) {
      try {
        window.localStorage.setItem(DEMO_KEY, "1")
      } catch {}
    } else {
      void markTourCompleted()
    }
  }, [isDemo, show])

  const next = React.useCallback(() => {
    if (index === null) return
    let target = index + 1
    while (target <= LAST && TOUR_STEPS[target].optional && !resolveAnchor(TOUR_STEPS[target])) target++
    if (target > LAST) finish()
    else show(target)
  }, [index, finish, show])

  const prev = React.useCallback(() => {
    if (index === null || index <= 1) return
    let target = index - 1
    while (target > 1 && TOUR_STEPS[target].optional && !resolveAnchor(TOUR_STEPS[target])) target--
    show(target)
  }, [index, show])

  const start = React.useCallback(() => {
    if (pathname === "/") {
      show(1)
    } else {
      setChosen(1)
      router.push("/?tour=1")
    }
  }, [pathname, router, show])

  const value = React.useMemo(() => ({ start }), [start])

  return (
    <TourContext.Provider value={value}>
      {children}
      {mounted && index !== null && (
        <TourOverlay key={index} index={index} onNext={next} onPrev={prev} onClose={finish} />
      )}
    </TourContext.Provider>
  )
}

/* --------------------------------- Overlay --------------------------------- */

const CARD_WIDTH = 340
const GAP = 14
const MARGIN = 16
const PADDING = 6

type Measure = { rect: DOMRect | null; viaMenu: boolean; cardHeight: number; vw: number; vh: number }

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Al lado de un ítem de la barra lateral; abajo o arriba de todo lo demás. */
function placeCard({ rect, cardHeight, vw, vh }: Measure) {
  if (!rect) return { top: (vh - cardHeight) / 2, left: (vw - CARD_WIDTH) / 2 }
  const fitsRight = rect.right + GAP + CARD_WIDTH + MARGIN <= vw
  if (fitsRight && rect.left < vw * 0.3 && rect.width < vw * 0.3) {
    return {
      left: rect.right + GAP,
      top: clamp(rect.top + rect.height / 2 - cardHeight / 2, MARGIN, vh - cardHeight - MARGIN),
    }
  }
  const below = rect.bottom + GAP
  const above = rect.top - GAP - cardHeight
  const top =
    below + cardHeight + MARGIN <= vh ? below : above >= MARGIN ? above : vh - cardHeight - MARGIN
  return { top, left: clamp(rect.left + rect.width / 2 - CARD_WIDTH / 2, MARGIN, vw - CARD_WIDTH - MARGIN) }
}

function TourOverlay({
  index,
  onNext,
  onPrev,
  onClose,
}: {
  index: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}) {
  const step = TOUR_STEPS[index]
  const cardRef = React.useRef<HTMLDivElement>(null)
  const primaryRef = React.useRef<HTMLButtonElement>(null)
  const [measure, setMeasure] = React.useState<Measure | null>(null)

  React.useEffect(() => {
    const anchor = resolveAnchor(step)
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    anchor?.element.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" })

    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setMeasure({
          rect: anchor ? anchor.element.getBoundingClientRect() : null,
          viaMenu: anchor?.viaMenu ?? false,
          cardHeight: cardRef.current?.offsetHeight ?? 200,
          vw: window.innerWidth,
          vh: window.innerHeight,
        })
      )
    }
    update()
    // Remedir cuando termina el scroll suave hasta el ancla.
    const settle = window.setTimeout(update, 400)
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [step])

  // Foco en el botón principal; al cerrar, vuelve a donde estaba.
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    primaryRef.current?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [])

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      } else if (event.key === "ArrowRight") {
        onNext()
      } else if (event.key === "ArrowLeft") {
        onPrev()
      } else if (event.key === "Tab" && cardRef.current) {
        const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, onNext, onPrev])

  const isMobile = (measure?.vw ?? 1024) < 640
  const rect = measure?.rect ?? null
  const hole = rect && {
    x: rect.left - PADDING,
    y: rect.top - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  }
  const position = measure && !isMobile ? placeCard(measure) : null
  const isWelcome = index === 0
  const isLast = index === LAST
  const body = measure?.viaMenu ? `${step.body} Lo encontrás en el menú.` : step.body

  return createPortal(
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {/* El fondo no cierra el tour: un clic sin querer no lo pierde. */}
      <svg className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <mask id="operon-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect {...hole} rx="14" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(12 11 8 / 0.62)" mask="url(#operon-tour-mask)" />
      </svg>

      {hole && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[14px] ring-2 ring-warning transition-all duration-300 motion-reduce:transition-none"
          style={{ left: hole.x, top: hole.y, width: hole.width, height: hole.height }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={cn(
          "absolute rounded-2xl border bg-popover p-5 text-popover-foreground shadow-2xl",
          "animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none",
          isMobile ? "inset-x-3 bottom-3" : "w-[340px]",
          !measure && "opacity-0"
        )}
        style={position ?? undefined}
      >
        <p className="label-mono text-primary">
          {isWelcome ? step.label : `${index} de ${LAST} · ${step.label}`}
        </p>
        <h2 id="tour-title" className="mt-2 text-lg leading-snug font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm text-muted-foreground">
          {body}
        </p>

        <div className="mt-5 flex items-center justify-between gap-2">
          {isLast ? (
            <span />
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onClose}>
              Saltar
            </Button>
          )}
          <div className="flex items-center gap-2">
            {index > 1 && (
              <Button variant="outline" size="icon-sm" aria-label="Paso anterior" onClick={onPrev}>
                <ArrowLeft />
              </Button>
            )}
            <Button ref={primaryRef} size="sm" onClick={isLast ? onClose : onNext}>
              {isWelcome ? "Empezar" : isLast ? "Terminar" : "Siguiente"}
              {!isLast && <ArrowRight />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
