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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  addDays,
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
  CircleCheck, Clock3, ExternalLink,
} from "lucide-react"
import type { CalendarSegment, CalendarKpis } from "@/app/(panel)/calendario/page"

type Unit = { id: string; name: string; capacity: number }

/** Geometría del grid. Cambiar acá reescala todo el calendario. */
const CELL_W = 56
const ROW_H = 88
const UNIT_COL_W = 264

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

function isWeekend(iso: string) {
  const d = new Date(iso + "T00:00:00").getDay()
  return d === 0 || d === 6
}

export function AvailabilityCalendar({
  organizationName,
  units,
  segments,
  startDate,
  days,
  kpis,
}: {
  organizationName: string
  units: Unit[]
  segments: CalendarSegment[]
  startDate: string
  days: number
  kpis: CalendarKpis
}) {
  const [selected, setSelected] = React.useState<CalendarSegment | null>(null)
  const today = todayISO()

  const dayList = React.useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate, days]
  )
  const endExclusive = addDays(startDate, days)

  const monthSpans = React.useMemo(() => {
    const out: { label: string; span: number }[] = []
    for (const d of dayList) {
      const [y, m] = d.split("-")
      const label = `${MONTHS[Number(m) - 1]} ${y}`
      const last = out[out.length - 1]
      if (last && last.label === label) last.span++
      else out.push({ label, span: 1 })
    }
    return out
  }, [dayList])

  /**
   * Posición de una barra dentro de la ventana. Se recorta a los bordes:
   * una estadía que empezó antes (o termina después) se dibuja sin el
   * redondeo de ese lado, para que se lea que continúa fuera de la vista.
   */
  const geometry = React.useCallback(
    (seg: CalendarSegment) => {
      const from = seg.start > startDate ? seg.start : startDate
      const to = seg.endExclusive < endExclusive ? seg.endExclusive : endExclusive
      const offset = nightsBetween(startDate, from)
      const span = nightsBetween(from, to)
      return {
        left: offset * CELL_W,
        width: span * CELL_W,
        openLeft: seg.start < startDate,
        openRight: seg.endExclusive > endExclusive,
      }
    },
    [startDate, endExclusive]
  )

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Firma de marca: cuarto de anillo en Sol, detrás de todo. */}
      <OperonArc className="inset-0" size={620} thickness={78} corner="bottom-right" />

      {/* ---------- Encabezado ---------- */}
      <header className={cn(ENTER, "shrink-0 px-6 pt-6")}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-mono text-primary">{organizationName}</p>
            <h1 className="mt-1 text-[28px] leading-tight font-semibold">
              Calendario de reservas
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Legend />
            <WindowNav startDate={startDate} days={days} today={today} />
            <BlockDialog units={units} startDate={startDate} />
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            icon={TrendingUp}
            label={`Ocupación · ${days} días`}
            value={`${kpis.occupancyPct}%`}
            tone="primary"
            delay={1}
          />
          <Kpi
            icon={Wallet}
            label="Por cobrar"
            value={formatCurrency(kpis.pendingRevenue, kpis.currency)}
            tone="success"
            delay={2}
          />
          <Kpi
            icon={DoorOpen}
            label="Llegadas hoy"
            value={String(kpis.checkinsToday)}
            tone="primary"
            delay={3}
          />
          <Kpi
            icon={Sparkles}
            label="Salidas hoy · limpieza"
            value={String(kpis.checkoutsToday)}
            tone="warning"
            delay={4}
          />
        </div>
      </header>

      {/* ---------- Grilla ---------- */}
      <div className="relative min-h-0 flex-1 p-6 pt-5">
        {units.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No hay unidades activas. Cargalas en la sección Unidades.
          </div>
        ) : (
          <div
            className={cn(
              ENTER_UP,
              // max-h y no h: con pocas unidades la tarjeta se ajusta al
              // contenido (y deja respirar el arco de marca); con muchas,
              // scrollea por dentro sin empujar la página.
              "max-h-full overflow-auto rounded-2xl border bg-card shadow-sm"
            )}
          >
            <div
              className="relative"
              style={{ width: UNIT_COL_W + days * CELL_W, minWidth: "100%" }}
            >
              {/* Encabezado: meses + días */}
              <div className="sticky top-0 z-30 flex bg-card">
                <div
                  className="sticky left-0 z-40 flex shrink-0 items-end border-r border-b bg-card px-5 pb-2"
                  style={{ width: UNIT_COL_W }}
                >
                  <span className="label-mono text-muted-foreground">Unidades</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex border-b">
                    {monthSpans.map((m) => (
                      <div
                        key={m.label}
                        className="label-mono border-r px-3 py-2 text-foreground last:border-r-0"
                        style={{ width: m.span * CELL_W }}
                      >
                        {m.label}
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
                      className="sticky left-0 z-20 flex shrink-0 items-center gap-3 border-r bg-card px-5"
                      style={{ width: UNIT_COL_W }}
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

                    {/* Celdas de fondo + barras posicionadas */}
                    <div className="relative flex-1">
                      <div className="absolute inset-0 flex">
                        {dayList.map((d) => (
                          <div
                            key={d}
                            className={cn(
                              "shrink-0 border-r border-border/50 last:border-r-0",
                              isWeekend(d) && "bg-muted/30",
                              d === today && "bg-primary/5"
                            )}
                            style={{ width: CELL_W }}
                          />
                        ))}
                      </div>

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
        "absolute top-5 right-6 bottom-6 z-40 flex w-[360px] flex-col overflow-hidden rounded-2xl border shadow-2xl",
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

function Legend() {
  return (
    <div className="flex items-center gap-3 rounded-full border bg-card px-3.5 py-2">
      {[
        { label: "Disponible", cls: "bg-muted-foreground/40" },
        { label: "Reservado", cls: "bg-primary" },
        { label: "Bloqueado", cls: "bg-warning" },
      ].map((l) => (
        <span key={l.label} className="label-mono flex items-center gap-1.5 text-muted-foreground">
          <span className={cn("size-2.5 rounded-full", l.cls)} />
          {l.label}
        </span>
      ))}
    </div>
  )
}

function WindowNav({
  startDate,
  days,
  today,
}: {
  startDate: string
  days: number
  today: string
}) {
  const prev = addDays(startDate, -days)
  const next = addDays(startDate, days)
  const icon = buttonVariants({ variant: "ghost", size: "icon-sm" })

  return (
    <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
      <Link href={`/calendario?desde=${prev}`} className={icon} aria-label="Período anterior">
        <ChevronLeft />
      </Link>
      <Link
        href="/calendario"
        className={buttonVariants({
          variant: startDate === today ? "secondary" : "ghost",
          size: "sm",
        })}
      >
        <CalendarDays /> Hoy
      </Link>
      <Link href={`/calendario?desde=${next}`} className={icon} aria-label="Período siguiente">
        <ChevronRight />
      </Link>
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
