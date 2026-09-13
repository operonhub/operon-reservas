"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { addDays, addMonths, nightsBetween } from "@/lib/format"
import { OperonArc } from "@/components/brand/operon-arc"
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Minimize2 } from "lucide-react"
import type { CalendarSegment } from "@/app/(panel)/calendario/page"

type Unit = { id: string; name: string }

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]

/** Alto de la cabecera de cada día (el número) y de cada carril de barras. */
const DAY_HEAD_H = 32
const LANE_H = 24

/** Una estadía recortada a una semana, ya ubicada en su carril. */
export type Placed = {
  seg: CalendarSegment
  /** Columna de la primera noche dentro de la semana (0 = lunes). */
  col: number
  /** Noches que ocupa dentro de la semana. */
  span: number
  lane: number
  /** Empezó la semana anterior / sigue la semana siguiente. */
  openLeft: boolean
  openRight: boolean
}

/**
 * Orden en que las estadías de una semana eligen carril. Decide qué queda a
 * la vista cuando no entran todas y aparece "+N más".
 */
export function compareForLanes(a: Placed, b: Placed): number {
  // Por primera noche: con ese orden el reparto greedy usa la mínima cantidad
  // de carriles. Si empatan, la estadía más larga va arriba, como en Google.
  return a.col - b.col || b.span - a.span
}

function layoutWeek(weekStart: string, segments: CalendarSegment[]): Placed[] {
  const weekEnd = addDays(weekStart, 7)
  const items = segments
    .filter((s) => s.start < weekEnd && s.endExclusive > weekStart)
    .map((s): Placed => {
      const from = s.start > weekStart ? s.start : weekStart
      const to = s.endExclusive < weekEnd ? s.endExclusive : weekEnd
      return {
        seg: s,
        col: nightsBetween(weekStart, from),
        span: nightsBetween(from, to),
        lane: 0,
        openLeft: s.start < weekStart,
        openRight: s.endExclusive > weekEnd,
      }
    })
    .sort(compareForLanes)

  // Cada carril recuerda dónde termina su última barra; la estadía entra en
  // el primero que ya quedó libre para su primera noche.
  const laneEnds: number[] = []
  for (const item of items) {
    let lane = laneEnds.findIndex((end) => end <= item.col)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = item.col + item.span
    item.lane = lane
  }
  return items
}

/** 0 = lunes … 6 = domingo. */
function mondayIndex(iso: string) {
  return (new Date(iso + "T00:00:00").getDay() + 6) % 7
}

function barTone(seg: CalendarSegment) {
  if (seg.kind === "block") return "block"
  return seg.status === "confirmed" || seg.status === "completed" ? "settled" : "pending"
}

export function MonthView({
  organizationName,
  units,
  segments,
  today,
  initialMonth,
  minMonth,
  maxMonth,
  selectedId,
  actions,
  onSelect,
  onClose,
  children,
}: {
  organizationName: string
  units: Unit[]
  segments: CalendarSegment[]
  today: string
  /** Día 1 del mes con el que abre. */
  initialMonth: string
  /** Primer y último mes que trajo la página: fuera de eso no hay datos. */
  minMonth: string
  maxMonth: string
  selectedId: string | null
  /** Acciones del encabezado (referencias, bloquear fechas). */
  actions?: React.ReactNode
  onSelect: (seg: CalendarSegment) => void
  /** Devuelve el mes en pantalla para que la línea de tiempo siga desde ahí. */
  onClose: (month: string) => void
  /** Panel de detalle de la estadía seleccionada. */
  children?: React.ReactNode
}) {
  const [month, setMonth] = React.useState(initialMonth)
  const [unitFilter, setUnitFilter] = React.useState("all")
  const [maxLanes, setMaxLanes] = React.useState(3)
  const bodyRef = React.useRef<HTMLDivElement>(null)

  const canPrev = month > minMonth
  const canNext = month < maxMonth
  const monthDow = mondayIndex(month)
  const weekCount = Math.ceil((monthDow + nightsBetween(month, addMonths(month, 1))) / 7)

  const weeks = React.useMemo(() => {
    const gridStart = addDays(month, -monthDow)
    return Array.from({ length: weekCount }, (_, i) => addDays(gridStart, i * 7))
  }, [month, monthDow, weekCount])

  const visible = React.useMemo(
    () => (unitFilter === "all" ? segments : segments.filter((s) => s.unitId === unitFilter)),
    [segments, unitFilter]
  )

  // Cuántos carriles entran depende del alto real de la pantalla: en un
  // monitor grande se ven todas las estadías, en una notebook aparece "+N".
  React.useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const row = el.firstElementChild as HTMLElement | null
      if (!row) return
      setMaxLanes(Math.max(1, Math.floor((row.offsetHeight - DAY_HEAD_H - 4) / LANE_H)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [weekCount])

  const hasSelection = selectedId !== null
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      // Con un menú o diálogo abierto, Esc y las flechas son de ellos.
      if (
        target.closest(
          "input, select, textarea, [data-slot=dropdown-menu-content], [data-slot=dialog-content]"
        )
      )
        return
      // Con el detalle abierto, el primer Esc lo cierra a él (tiene su propio
      // listener) y recién el segundo contrae la vista.
      if (e.key === "Escape" && !hasSelection) onClose(month)
      else if (e.key === "ArrowLeft" && canPrev) setMonth(addMonths(month, -1))
      else if (e.key === "ArrowRight" && canNext) setMonth(addMonths(month, 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [hasSelection, onClose, month, canPrev, canNext])

  const monthName = `${new Date(month + "T00:00:00").toLocaleDateString("es-AR", {
    month: "long",
  })} ${month.slice(0, 4)}`
  const isCurrentMonth = month.slice(0, 7) === today.slice(0, 7)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Calendario de ${monthName}`}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
    >
      <OperonArc className="inset-0" size={620} thickness={78} corner="bottom-right" />

      <header className="relative flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <p className="label-mono truncate text-primary">{organizationName}</p>
          <h1 className="mt-1 text-2xl leading-tight font-semibold capitalize sm:text-[28px]">
            {monthName}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Mes anterior"
              disabled={!canPrev}
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant={isCurrentMonth ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMonth(`${today.slice(0, 7)}-01`)}
            >
              <CalendarDays /> Hoy
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Mes siguiente"
              disabled={!canNext}
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>

          <select
            aria-label="Filtrar por unidad"
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="h-9 max-w-[13rem] cursor-pointer truncate rounded-xl border bg-card px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">Todas las unidades</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          {actions}

          <Button variant="ghost" size="sm" onClick={() => onClose(month)}>
            <Minimize2 /> Contraer
            <kbd className="label-mono ml-1 hidden rounded border bg-muted px-1 text-muted-foreground lg:inline">
              Esc
            </kbd>
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col p-3 sm:p-6 sm:pt-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="grid shrink-0 grid-cols-7 border-b">
            {WEEKDAYS.map((d, i) => (
              <div
                key={d}
                className={cn(
                  "label-mono border-r px-2 py-2 text-muted-foreground last:border-r-0 sm:px-3",
                  i >= 5 && "bg-muted/40"
                )}
              >
                {d}
              </div>
            ))}
          </div>

          <div
            ref={bodyRef}
            className="grid min-h-0 flex-1 overflow-y-auto"
            style={{ gridTemplateRows: `repeat(${weekCount}, minmax(7rem, 1fr))` }}
          >
            {weeks.map((weekStart) => (
              <WeekRow
                key={weekStart}
                weekStart={weekStart}
                month={month}
                today={today}
                segments={visible}
                maxLanes={maxLanes}
                showUnit={unitFilter === "all" && units.length > 1}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>

        {children}
      </div>
    </div>
  )
}

function WeekRow({
  weekStart,
  month,
  today,
  segments,
  maxLanes,
  showUnit,
  selectedId,
  onSelect,
}: {
  weekStart: string
  month: string
  today: string
  segments: CalendarSegment[]
  maxLanes: number
  showUnit: boolean
  selectedId: string | null
  onSelect: (seg: CalendarSegment) => void
}) {
  const placed = React.useMemo(() => layoutWeek(weekStart, segments), [weekStart, segments])
  const laneCount = placed.reduce((n, p) => Math.max(n, p.lane + 1), 0)
  // Si no entran todos los carriles, el último se cede al "+N más".
  const visibleLanes = laneCount > maxLanes ? maxLanes - 1 : maxLanes

  return (
    <div className="relative grid grid-cols-7 border-b last:border-b-0">
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(weekStart, i)
        const inMonth = day.slice(0, 7) === month.slice(0, 7)
        const covering = placed.filter((p) => p.col <= i && i < p.col + p.span)
        const hidden = covering.filter((p) => p.lane >= visibleLanes).length

        return (
          <div
            key={day}
            className={cn(
              "relative min-w-0 border-r last:border-r-0",
              i >= 5 && "bg-muted/40",
              !inMonth && "bg-muted/70"
            )}
          >
            <div className="flex items-center px-1.5 sm:px-2" style={{ height: DAY_HEAD_H }}>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full font-mono text-[12px] tabular-nums",
                  day === today
                    ? "bg-primary font-bold text-primary-foreground"
                    : inMonth
                      ? "text-foreground"
                      : "text-muted-foreground/70"
                )}
              >
                {Number(day.slice(8))}
              </span>
            </div>

            {hidden > 0 && (
              <MoreMenu
                day={day}
                hidden={hidden}
                covering={covering}
                top={DAY_HEAD_H + visibleLanes * LANE_H}
                onSelect={onSelect}
              />
            )}
          </div>
        )
      })}

      {placed
        .filter((p) => p.lane < visibleLanes)
        .map((p) => (
          <MonthBar
            key={p.seg.id}
            placed={p}
            showUnit={showUnit}
            active={selectedId === p.seg.id}
            onSelect={() => onSelect(p.seg)}
          />
        ))}
    </div>
  )
}

function MonthBar({
  placed: p,
  showUnit,
  active,
  onSelect,
}: {
  placed: Placed
  showUnit: boolean
  active: boolean
  onSelect: () => void
}) {
  const { seg } = p
  const tone = barTone(seg)
  // Misma lectura que la línea de tiempo: sólida = cerrada, tenue = pendiente,
  // sol = bloqueo. Una barra que sigue en otra semana pierde el redondeo de ese lado.
  const insetL = p.openLeft ? 0 : 3
  const insetR = p.openRight ? 0 : 3

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${seg.unitName} · ${seg.label} (${seg.start} → ${seg.endExclusive})`}
      style={{
        top: DAY_HEAD_H + p.lane * LANE_H,
        left: `calc(${p.col} * 100% / 7 + ${insetL}px)`,
        width: `calc(${p.span} * 100% / 7 - ${insetL + insetR}px)`,
        height: LANE_H - 3,
      }}
      className={cn(
        "absolute z-10 flex items-center gap-1.5 overflow-hidden px-2 text-left text-[12px] leading-none whitespace-nowrap transition-[filter,background-color,box-shadow]",
        "hover:z-20 hover:shadow-md motion-reduce:transition-none",
        tone === "block" && "border border-warning/50 bg-warning/25 hover:bg-warning/35",
        tone === "settled" && "bg-primary text-primary-foreground hover:brightness-110",
        tone === "pending" && "border border-primary/40 bg-primary/10 hover:bg-primary/20",
        p.openLeft ? "rounded-l-none" : "rounded-l-md",
        p.openRight ? "rounded-r-none" : "rounded-r-md",
        active && "ring-2 ring-ring ring-offset-1 ring-offset-card"
      )}
    >
      {tone === "block" && <Ban className="size-3 shrink-0" />}
      <span className="truncate font-semibold">{seg.label}</span>
      {showUnit && (
        <span
          className={cn(
            "hidden truncate sm:inline",
            tone === "settled" ? "text-primary-foreground/75" : "text-muted-foreground"
          )}
        >
          · {seg.unitName}
        </span>
      )}
    </button>
  )
}

const DOT = {
  block: "bg-warning",
  settled: "bg-primary",
  pending: "border border-primary bg-primary/15",
}

function MoreMenu({
  day,
  hidden,
  covering,
  top,
  onSelect,
}: {
  day: string
  hidden: number
  covering: Placed[]
  top: number
  onSelect: (seg: CalendarSegment) => void
}) {
  const label = new Date(day + "T00:00:00").toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="label-mono absolute inset-x-1 z-10 truncate rounded px-1.5 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            style={{ top, height: LANE_H - 3 }}
          />
        }
      >
        +{hidden} más
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="first-letter:uppercase">{label}</DropdownMenuLabel>
          {covering.map((p) => (
            <DropdownMenuItem key={p.seg.id} onClick={() => onSelect(p.seg)}>
              <span className={cn("size-2.5 shrink-0 rounded-full", DOT[barTone(p.seg)])} />
              <span className="min-w-0 truncate">{p.seg.label}</span>
              <span className="label-mono ml-auto shrink-0 text-muted-foreground">
                {p.seg.unitName}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
