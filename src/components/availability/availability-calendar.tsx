"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  addDays,
  addMonths,
  startOfMonth,
  todayISO,
  nightsBetween,
  formatCurrency,
  whatsappHref,
  initials,
} from "@/lib/format"
import { RESERVATION_STATUS_LABELS } from "@/lib/constants"
import { ENTER, ENTER_UP, stagger } from "@/lib/motion"
import { OperonArc } from "@/components/brand/operon-arc"
import { createBlock, deleteBlock } from "@/app/(panel)/calendario/actions"
import {
  Ban, Plus, ChevronLeft, ChevronRight, CalendarDays, X, Users, Moon,
  LogIn, LogOut, Mail, MessageCircle, TrendingUp, Wallet, DoorOpen, Sparkles,
  CircleCheck, Clock3, ExternalLink, Info,
} from "lucide-react"
import type { CalendarSegment } from "@/app/(panel)/calendario/page"

type Unit = { id: string; name: string; capacity: number }

/**
 * Geometría del grid. Cambiar acá reescala todo el calendario.
 * El ancho de la columna de unidades vive en la variable CSS `--unit-col`
 * porque cambia por breakpoint.
 */
const CELL_W = 56
const ROW_H = 88

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

function isWeekend(iso: string) {
  const d = new Date(iso + "T00:00:00").getDay()
  return d === 0 || d === 6
}

function monthLabel(iso: string) {
  const [y, m] = iso.split("-")
  return `${MONTHS[Number(m) - 1]} ${y}`
}

/**
 * Fondo de una fila (líneas de día + sombreado de fin de semana) dibujado con
 * gradientes en vez de un div por día: con 14 meses cargados serían ~420
 * elementos por unidad, y el scroll se vuelve pesado.
 */
function rowBackground(rangeStart: string) {
  const firstDow = new Date(rangeStart + "T00:00:00").getDay()
  const week = Array.from({ length: 7 }, (_, i) => {
    const dow = (firstDow + i) % 7
    const tint =
      dow === 0 || dow === 6
        ? "color-mix(in oklab, var(--muted) 55%, transparent)"
        : "transparent"
    return `${tint} ${i * CELL_W}px ${(i + 1) * CELL_W}px`
  }).join(",")

  return {
    backgroundImage: [
      `linear-gradient(90deg, color-mix(in oklab, var(--border) 55%, transparent) 0 1px, transparent 1px ${CELL_W}px)`,
      `linear-gradient(90deg, ${week})`,
    ].join(","),
    backgroundSize: `${CELL_W}px 100%, ${CELL_W * 7}px 100%`,
  }
}

export function AvailabilityCalendar({
  organizationName,
  units,
  segments,
  rangeStart,
  rangeDays,
  currency,
}: {
  organizationName: string
  units: Unit[]
  segments: CalendarSegment[]
  rangeStart: string
  rangeDays: number
  currency: string
}) {
  const [selected, setSelected] = React.useState<CalendarSegment | null>(null)
  const today = todayISO()
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const dayList = React.useMemo(
    () => Array.from({ length: rangeDays }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, rangeDays]
  )
  const endExclusive = addDays(rangeStart, rangeDays)

  /** Meses del rango, con el offset en px donde arranca cada uno. */
  const months = React.useMemo(() => {
    const out: { key: string; label: string; offset: number; span: number }[] = []
    dayList.forEach((d, i) => {
      const key = d.slice(0, 7)
      const last = out[out.length - 1]
      if (last && last.key === key) last.span++
      else out.push({ key, label: monthLabel(d), offset: i * CELL_W, span: 1 })
    })
    return out
  }, [dayList])

  // Mes en el que está parado el scroll. Es lo que titula la vista y lo que
  // alimenta los KPIs, así que se actualiza mientras el usuario se mueve.
  const [viewMonth, setViewMonth] = React.useState(() => startOfMonth(today))

  const scrollToMonth = React.useCallback(
    (key: string, behavior: ScrollBehavior = "smooth") => {
      const target = months.find((m) => m.key === key)
      const node = scrollRef.current
      if (!target || !node) return
      node.scrollTo({ left: target.offset, behavior })
      setViewMonth(`${key}-01`)
    },
    [months]
  )

  // Al abrir, el calendario arranca en el mes actual, no en el borde del
  // rango cargado (que empieza un mes antes).
  React.useEffect(() => {
    scrollToMonth(startOfMonth(today).slice(0, 7), "instant")
    // Solo en el montaje: después manda el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const left = event.currentTarget.scrollLeft
    // El mes visible es el último que ya arrancó a la izquierda del viewport.
    let current = months[0]
    for (const m of months) {
      if (m.offset <= left + CELL_W * 2) current = m
      else break
    }
    const iso = `${current.key}-01`
    if (iso !== viewMonth) setViewMonth(iso)
  }

  const monthIndex = months.findIndex((m) => m.key === viewMonth.slice(0, 7))

  /** Posición de la columna de hoy dentro del rango (null si queda afuera). */
  const todayOffset =
    today >= rangeStart && today < endExclusive
      ? nightsBetween(rangeStart, today) * CELL_W
      : null

  /** KPIs del mes que se está mirando. */
  const kpis = React.useMemo(() => {
    const from = viewMonth
    const to = addMonths(viewMonth, 1)
    const monthDays = nightsBetween(from, to)

    const reservedNights = segments
      .filter((s) => s.kind === "reservation")
      .reduce((sum, s) => {
        const a = s.start > from ? s.start : from
        const b = s.endExclusive < to ? s.endExclusive : to
        return sum + Math.max(0, nightsBetween(a, b))
      }, 0)

    const inMonth = segments.filter((s) => s.start < to && s.endExclusive > from)

    return {
      occupancyPct:
        units.length > 0
          ? Math.round((reservedNights / (units.length * monthDays)) * 100)
          : 0,
      pendingRevenue: inMonth
        .filter((s) => s.status === "confirmed")
        .reduce(
          (sum, s) => sum + Math.max(0, Number(s.totalAmount ?? 0) - s.paidAmount),
          0
        ),
      checkins: inMonth.filter((s) => s.kind === "reservation" && s.start >= from)
        .length,
      checkouts: inMonth.filter(
        (s) => s.kind === "reservation" && s.endExclusive < to
      ).length,
    }
  }, [segments, units.length, viewMonth])

  /**
   * Posición de una barra dentro de la ventana. Se recorta a los bordes:
   * una estadía que empezó antes (o termina después) se dibuja sin el
   * redondeo de ese lado, para que se lea que continúa fuera de la vista.
   */
  const geometry = React.useCallback(
    (seg: CalendarSegment) => {
      const from = seg.start > rangeStart ? seg.start : rangeStart
      const to = seg.endExclusive < endExclusive ? seg.endExclusive : endExclusive
      const offset = nightsBetween(rangeStart, from)
      const span = nightsBetween(from, to)
      return {
        left: offset * CELL_W,
        width: span * CELL_W,
        openLeft: seg.start < rangeStart,
        openRight: seg.endExclusive > endExclusive,
      }
    },
    [rangeStart, endExclusive]
  )

  return (
    // `lg:h-full`: en escritorio ocupa la pantalla y scrollea por dentro;
    // en mobile fluye hacia abajo, que es como se lee un celular.
    <div className="relative flex flex-col lg:h-full lg:overflow-hidden">
      {/* Firma de marca: cuarto de anillo en Sol, detrás de todo. */}
      <OperonArc className="inset-0" size={620} thickness={78} corner="bottom-right" />

      {/* ---------- Encabezado ---------- */}
      <header className={cn(ENTER, "shrink-0 px-4 pt-5 sm:px-6 sm:pt-6")}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-mono text-primary">{organizationName}</p>
            <h1 className="mt-1 text-2xl leading-tight font-semibold sm:text-[28px]">
              Calendario de reservas
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Legend />
            <BlockDialog units={units} startDate={today} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <MonthNav
            months={months}
            index={monthIndex}
            onGo={scrollToMonth}
            onToday={() => scrollToMonth(today.slice(0, 7))}
            isToday={viewMonth === startOfMonth(today)}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            icon={TrendingUp}
            label="Ocupación del mes"
            value={`${kpis.occupancyPct}%`}
            tone="primary"
            delay={1}
          />
          <Kpi
            icon={Wallet}
            label="Por cobrar"
            value={formatCurrency(kpis.pendingRevenue, currency)}
            tone="success"
            delay={2}
          />
          <Kpi
            icon={DoorOpen}
            label="Llegadas del mes"
            value={String(kpis.checkins)}
            tone="primary"
            delay={3}
          />
          <Kpi
            icon={Sparkles}
            label="Salidas · limpieza"
            value={String(kpis.checkouts)}
            tone="warning"
            delay={4}
          />
        </div>
      </header>

      {/* ---------- Grilla ---------- */}
      <div className="relative min-h-0 flex-1 p-4 pt-4 sm:p-6 sm:pt-5">
        {units.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No hay unidades activas. Cargalas en la sección Unidades.
          </div>
        ) : (
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className={cn(
              ENTER_UP,
              // max-h y no h: con pocas unidades la tarjeta se ajusta al
              // contenido (y deja respirar el arco de marca); con muchas,
              // scrollea por dentro sin empujar la página.
              "max-h-full overflow-auto overscroll-x-contain rounded-2xl border bg-card shadow-sm",
              // La columna de unidades se angosta en mobile: con 264px fijos
              // se comía 3/4 de la pantalla y no quedaban días a la vista.
              "[--unit-col:9.5rem] lg:[--unit-col:16.5rem]"
            )}
          >
            <div
              className="relative"
              style={{
                width: `calc(var(--unit-col) + ${rangeDays * CELL_W}px)`,
                minWidth: "100%",
              }}
            >
              {/* Encabezado: meses + días */}
              <div className="sticky top-0 z-30 flex bg-card">
                <div
                  className="sticky left-0 z-40 flex shrink-0 items-end border-r border-b bg-card px-4 pb-2 lg:px-5"
                  style={{ width: "var(--unit-col)" }}
                >
                  <span className="label-mono text-muted-foreground">Unidades</span>
                </div>
                <div className="flex flex-col">
                  <div className="relative h-9 border-b">
                    {months.map((m) => (
                      <div
                        key={m.key}
                        className="absolute inset-y-0 border-r"
                        style={{ left: m.offset, width: m.span * CELL_W }}
                      >
                        {/* El nombre del mes acompaña el scroll mientras ese
                            mes esté en pantalla, frenando contra la columna de
                            unidades, así siempre se sabe dónde se está parado. */}
                        <span
                          className="label-mono sticky inline-block px-3 py-2 text-foreground"
                          style={{ left: "var(--unit-col)" }}
                        >
                          {m.label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex border-b">
                    {dayList.map((d) => {
                      const isToday = d === today
                      const wd = new Date(d + "T00:00:00")
                        .toLocaleDateString("es-AR", { weekday: "short" })
                        .replace(".", "")
                      return (
                        <div
                          key={d}
                          className={cn(
                            "relative flex shrink-0 flex-col items-center justify-center py-1.5",
                            isWeekend(d) && "bg-muted/40",
                            isToday && "bg-primary/10"
                          )}
                          style={{ width: CELL_W }}
                        >
                          <span
                            className={cn(
                              "font-mono text-[13px] tabular-nums",
                              isToday ? "font-bold text-primary" : "text-foreground"
                            )}
                          >
                            {d.slice(8, 10)}
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 text-[10px] uppercase",
                              isToday ? "text-primary" : "text-muted-foreground"
                            )}
                          >
                            {wd}
                          </span>
                          {isToday && (
                            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Filas por unidad */}
              {units.map((u, rowIdx) => {
                const rowSegments = segments.filter((s) => s.unitId === u.id)
                return (
                  <div
                    key={u.id}
                    className={cn(ENTER, "flex border-b last:border-b-0")}
                    style={{ ...stagger(rowIdx, 40), height: ROW_H }}
                  >
                    <div
                      className="sticky left-0 z-20 flex shrink-0 items-center gap-2.5 border-r bg-card px-4 lg:gap-3 lg:px-5"
                      style={{ width: "var(--unit-col)" }}
                    >
                      <span className="h-11 w-1.5 shrink-0 rounded-full bg-primary/40" />
                      <div className="min-w-0">
                        <p className="truncate font-heading text-[15px] font-semibold tracking-tight">
                          {u.name}
                        </p>
                        <span className="label-mono mt-1.5 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                          <Users className="size-3" />
                          {u.capacity}p
                        </span>
                      </div>
                    </div>

                    {/* Fondo por gradiente + barras posicionadas */}
                    <div className="relative flex-1" style={rowBackground(rangeStart)}>
                      {todayOffset !== null && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 z-0 bg-primary/10"
                          style={{ left: todayOffset, width: CELL_W }}
                        />
                      )}

                      {rowSegments.map((seg) => (
                        <OccupancyBar
                          key={seg.id}
                          seg={seg}
                          geo={geometry(seg)}
                          active={selected?.id === seg.id}
                          onSelect={() => setSelected(seg)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {selected && <DetailPanel seg={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}

/* ============================ Barra ============================ */

function OccupancyBar({
  seg,
  geo,
  active,
  onSelect,
}: {
  seg: CalendarSegment
  geo: { left: number; width: number; openLeft: boolean; openRight: boolean }
  active: boolean
  onSelect: () => void
}) {
  const isBlock = seg.kind === "block"
  // Confirmada = sólida; todavía sin confirmar = tenue con borde. Se lee de
  // un vistazo qué está cerrado y qué no, sin recurrir a otro color.
  const settled = seg.status === "confirmed" || seg.status === "completed"

  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${seg.unitName} · ${seg.label} (${seg.start} → ${seg.endExclusive})`}
      style={{ left: geo.left + 2, width: Math.max(0, geo.width - 4), height: 56 }}
      className={cn(
        "absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-2.5 overflow-hidden px-3 text-left transition-all",
        "hover:z-20 hover:shadow-lg motion-reduce:transition-none",
        isBlock
          ? "border border-warning/50 bg-warning/20 hover:bg-warning/30"
          : settled
            ? "bg-primary text-primary-foreground hover:brightness-110"
            : "border border-primary/40 bg-primary/10 hover:bg-primary/20",
        geo.openLeft ? "rounded-l-none" : "rounded-l-xl",
        geo.openRight ? "rounded-r-none" : "rounded-r-xl",
        active && "ring-2 ring-ring ring-offset-2 ring-offset-card"
      )}
    >
      <span
        className={cn(
          "h-8 w-1.5 shrink-0 rounded-full",
          isBlock ? "bg-warning" : settled ? "bg-primary-foreground/50" : "bg-primary"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">
          {isBlock ? seg.label : seg.label}
        </span>
        <span
          className={cn(
            "mt-0.5 flex items-center gap-1 text-[10px]",
            settled && !isBlock ? "text-primary-foreground/80" : "text-muted-foreground"
          )}
        >
          {isBlock ? (
            <>
              <Ban className="size-3" /> Bloqueado
            </>
          ) : settled ? (
            <>
              <CircleCheck className="size-3" /> {seg.nights}N · {seg.guestsCount}p
            </>
          ) : (
            <>
              <Clock3 className="size-3" /> {seg.status ? RESERVATION_STATUS_LABELS[seg.status] : ""}
            </>
          )}
        </span>
      </span>
    </button>
  )
}

/* ========================= Panel de detalle ========================= */

function DetailPanel({ seg, onClose }: { seg: CalendarSegment; onClose: () => void }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const isBlock = seg.kind === "block"
  const balance =
    seg.totalAmount != null ? Math.max(0, Number(seg.totalAmount) - seg.paidAmount) : null
  const fullyPaid = balance === 0 && seg.totalAmount != null

  // Cerrar con Escape: es un overlay, tiene que poder salirse sin mouse.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function onUnblock() {
    if (!confirm(`¿Quitar el bloqueo "${seg.label}" de ${seg.unitName}?`)) return
    setPending(true)
    const res = await deleteBlock(seg.id)
    setPending(false)
    if (res.ok) {
      toast.success("Bloqueo eliminado.")
      onClose()
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo quitar el bloqueo.")
    }
  }

  return (
    <aside
      className={cn(
        // Mobile: drawer a pantalla completa (mismo patrón que reservas).
        // Desde `lg` recupera el look de tarjeta flotante sobre la grilla.
        "fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col overflow-hidden border-l shadow-2xl",
        "lg:absolute lg:inset-y-auto lg:top-5 lg:right-6 lg:bottom-6 lg:z-40 lg:w-[360px] lg:rounded-2xl lg:border",
        "bg-card/85 backdrop-blur-xl",
        "animate-in fade-in slide-in-from-right-4 duration-300 motion-reduce:animate-none"
      )}
      aria-label="Detalle de la reserva"
    >
      <div className="flex items-center justify-between border-b bg-muted/40 px-5 py-4">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          {isBlock ? "Detalle del bloqueo" : "Detalle de reserva"}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar">
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-secondary font-heading text-lg font-semibold">
            {isBlock ? <Ban className="size-6 text-warning" /> : initials(seg.label)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-heading text-lg font-semibold tracking-tight">
              {seg.label}
            </p>
            {seg.code && (
              <p className="label-mono mt-1 text-muted-foreground">{seg.code}</p>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border bg-background/60 p-4">
          <Field label="Unidad" value={`${seg.unitName}`} />
          <div className="h-px bg-border" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="label-mono flex items-center gap-1 text-muted-foreground">
                <LogIn className="size-3" /> Check-in
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {seg.start}
              </p>
            </div>
            <div>
              <p className="label-mono flex items-center gap-1 text-muted-foreground">
                <LogOut className="size-3" /> Check-out
              </p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {seg.endExclusive}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 rounded-lg bg-muted px-3 py-2">
            <Moon className="size-4 text-primary" />
            <span className="text-sm font-medium">
              {seg.nights} {seg.nights === 1 ? "noche" : "noches"}
              {seg.guestsCount != null && ` · ${seg.guestsCount} personas`}
            </span>
          </div>
        </div>

        {!isBlock && seg.totalAmount != null && (
          <div className="space-y-3">
            <p className="label-mono text-muted-foreground">Resumen de pago</p>
            <div
              className={cn(
                "flex items-center justify-between rounded-xl border p-4",
                fullyPaid ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/15"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {fullyPaid ? (
                  <>
                    <CircleCheck className="size-4 text-success" /> Abonado
                  </>
                ) : (
                  <>
                    <Clock3 className="size-4" /> Saldo pendiente
                  </>
                )}
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {formatCurrency(fullyPaid ? seg.totalAmount : balance, seg.currency)}
              </span>
            </div>
            <div className="space-y-2 rounded-xl border bg-background/60 p-4">
              <Row label="Total de la estadía" value={formatCurrency(seg.totalAmount, seg.currency)} />
              <Row label="Seña" value={formatCurrency(seg.depositAmount, seg.currency)} />
              <Row label="Cobrado" value={formatCurrency(seg.paidAmount, seg.currency)} />
            </div>
          </div>
        )}

        {(seg.guestPhone || seg.guestEmail) && (
          <div className="flex flex-wrap gap-2">
            {seg.guestPhone && (
              <a
                href={whatsappHref(seg.guestPhone)}
                target="_blank"
                rel="noopener noreferrer"
                className="label-mono inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1.5 transition-colors hover:bg-success/25"
              >
                <MessageCircle className="size-3" /> WhatsApp
              </a>
            )}
            {seg.guestEmail && (
              <a
                href={`mailto:${seg.guestEmail}`}
                className="label-mono inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Mail className="size-3 shrink-0" />
                <span className="truncate">{seg.guestEmail}</span>
              </a>
            )}
          </div>
        )}
      </div>

      <div className="border-t bg-muted/40 p-4">
        {isBlock ? (
          <Button
            variant="destructive"
            className="w-full"
            onClick={onUnblock}
            disabled={pending}
          >
            <Ban /> {pending ? "Quitando…" : "Quitar bloqueo"}
          </Button>
        ) : (
          seg.reservationId && (
            <Link
              href={`/reservas/${seg.reservationId}`}
              className={cn(buttonVariants({ size: "lg" }), "w-full")}
            >
              <ExternalLink /> Abrir reserva
            </Link>
          )
        )}
      </div>
    </aside>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </div>
  )
}

/* ============================ Piezas del header ============================ */

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  delay,
}: {
  icon: React.ElementType
  label: string
  value: string
  tone: "primary" | "success" | "warning"
  delay: number
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/25 text-foreground",
  }[tone]

  return (
    <div
      className={cn(ENTER_UP, "flex items-center gap-3 rounded-xl border bg-card p-3.5")}
      style={stagger(delay)}
    >
      <span
        className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", toneClass)}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="label-mono truncate text-muted-foreground">{label}</p>
        <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

const LEGEND = [
  { label: "Disponible", cls: "bg-muted-foreground/40" },
  { label: "Reservado", cls: "bg-primary" },
  { label: "Bloqueado", cls: "bg-warning" },
]

/**
 * En pantallas anchas la referencia va siempre a la vista; en mobile se
 * guarda detrás de un botón para no comerse una fila entera del encabezado.
 */
function Legend() {
  return (
    <>
      <div className="hidden items-center gap-3 rounded-full border bg-card px-3.5 py-2 sm:flex">
        {LEGEND.map((l) => (
          <span
            key={l.label}
            className="label-mono flex items-center gap-1.5 text-muted-foreground"
          >
            <span className={cn("size-2.5 rounded-full", l.cls)} />
            {l.label}
          </span>
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="sm:hidden" />}
        >
          <Info /> Referencias
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {LEGEND.map((l) => (
            <DropdownMenuItem key={l.label} className="pointer-events-none">
              <span className={cn("size-2.5 shrink-0 rounded-full", l.cls)} />
              {l.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/**
 * Navegación entre meses. Todo el rango ya está en memoria, así que moverse
 * es scrollear el contenedor: no hay ida al servidor ni recarga.
 */
function MonthNav({
  months,
  index,
  onGo,
  onToday,
  isToday,
}: {
  months: { key: string; label: string }[]
  index: number
  onGo: (key: string) => void
  onToday: () => void
  isToday: boolean
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Mes anterior"
        disabled={index <= 0}
        onClick={() => onGo(months[index - 1].key)}
      >
        <ChevronLeft />
      </Button>

      {/* El <select> nativo es lo más rápido para saltar a un mes lejano, y
          en mobile abre el selector del sistema. */}
      <div className="relative">
        <select
          aria-label="Ir a un mes"
          value={months[index]?.key ?? ""}
          onChange={(e) => onGo(e.target.value)}
          className="w-[10.5rem] cursor-pointer appearance-none rounded-lg bg-transparent px-3 py-1.5 text-center text-sm font-medium capitalize outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key} className="capitalize">
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Mes siguiente"
        disabled={index < 0 || index >= months.length - 1}
        onClick={() => onGo(months[index + 1].key)}
      >
        <ChevronRight />
      </Button>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <Button
        variant={isToday ? "secondary" : "ghost"}
        size="sm"
        onClick={onToday}
      >
        <CalendarDays /> Hoy
      </Button>
    </div>
  )
}

function BlockDialog({ units, startDate }: { units: Unit[]; startDate: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function handle(formData: FormData) {
    setPending(true)
    const res = await createBlock(formData)
    setPending(false)
    if (res.ok) {
      toast.success("Fechas bloqueadas.")
      setOpen(false)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo bloquear.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Ban /> Bloquear fechas
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear fechas</DialogTitle>
          <DialogDescription>
            El bloqueo resta disponibilidad igual que una reserva (mantenimiento, uso propio, etc.).
          </DialogDescription>
        </DialogHeader>

        <form action={handle} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="unit_id">Unidad</Label>
            <select
              id="unit_id"
              name="unit_id"
              required
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="start">Desde</Label>
              <Input id="start" name="start" type="date" min={startDate} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end">Hasta (excl.)</Label>
              <Input id="end" name="end" type="date" min={startDate} required />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Input id="reason" name="reason" placeholder="Mantenimiento" />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={pending}>
              <Plus /> {pending ? "Bloqueando…" : "Bloquear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
