"use client"

import * as React from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusBadge, SourceBadge } from "@/components/reservations/reservation-badges"
import { StatusControl } from "@/components/reservations/status-control"
import { formatCurrency, formatDay, whatsappHref, initials } from "@/lib/format"
import { ENTER, ENTER_UP, stagger } from "@/lib/motion"
import {
  Search, X, Users, Moon, Hash, Wallet, Globe, ExternalLink, Mail,
  MessageCircle, CircleCheck, Clock3, LogIn, LogOut, FilePlus2, CircleX,
} from "lucide-react"
import type { Enums } from "@/lib/supabase/types"

export type ReservationRow = {
  id: string
  code: string
  status: Enums<"reservation_status">
  source: Enums<"reservation_source">
  checkIn: string
  checkOut: string
  nights: number
  guestsCount: number
  guestName: string
  guestEmail: string | null
  guestPhone: string | null
  unitName: string
  unitCapacity: number | null
  totalAmount: number | null
  depositAmount: number | null
  paidAmount: number
  currency: string
  notes: string | null
  createdAt: string
  updatedAt: string
  payments: { amount: number; status: string; kind: string; paidAt: string | null }[]
}

export function ReservationsBoard({
  rows,
  today,
}: {
  rows: ReservationRow[]
  today: string
}) {
  const [q, setQ] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  // Búsqueda en memoria: la vista ya viene acotada por el filtro de estado y
  // topeada a 200 filas, así que filtrar acá evita un round-trip por tecla.
  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((r) =>
      [r.code, r.guestName, r.unitName].some((v) => v.toLowerCase().includes(term))
    )
  }, [rows, q])

  // El seleccionado se resuelve por id contra la lista completa: si el
  // usuario sigue tipeando, el panel abierto no se cierra solo.
  const selected = React.useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId]
  )

  const totals = React.useMemo(() => {
    const money = filtered.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0)
    const due = filtered
      .filter((r) => r.status === "confirmed" || r.status === "pending_payment")
      .reduce((s, r) => s + Math.max(0, Number(r.totalAmount ?? 0) - r.paidAmount), 0)
    return { money, due, currency: filtered[0]?.currency ?? "ARS" }
  }, [filtered])

  return (
    <div className="relative">
      <div className={cn(ENTER, "mb-4 flex flex-wrap items-center justify-between gap-3")}>
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por código, huésped o unidad…"
            className="pl-8"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="label-mono flex flex-wrap items-center gap-4 text-muted-foreground">
          <span>
            {filtered.length} {filtered.length === 1 ? "reserva" : "reservas"}
          </span>
          <span>
            Facturado{" "}
            <span className="text-foreground">
              {formatCurrency(totals.money, totals.currency)}
            </span>
          </span>
          {totals.due > 0 && (
            <span>
              Por cobrar{" "}
              <span className="text-foreground">
                {formatCurrency(totals.due, totals.currency)}
              </span>
            </span>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {q ? `Sin resultados para "${q}".` : "No hay reservas en este filtro."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((r, i) => (
            <ReservationStrip
              key={r.id}
              row={r}
              index={i}
              active={selectedId === r.id}
              onSelect={() => setSelectedId(r.id)}
            />
          ))}
        </div>
      )}

      {selected && (
        <DetailPanel row={selected} today={today} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}

/* =========================== Strip =========================== */

function ReservationStrip({
  row,
  index,
  active,
  onSelect,
}: {
  row: ReservationRow
  index: number
  active: boolean
  onSelect: () => void
}) {
  const total = Number(row.totalAmount ?? 0)
  const balance = Math.max(0, total - row.paidAmount)
  const pct = total > 0 ? Math.min(100, Math.round((row.paidAmount / total) * 100)) : 0
  const settled = total > 0 && balance === 0

  return (
    <button
      type="button"
      onClick={onSelect}
      style={stagger(index, 40)}
      className={cn(
        ENTER_UP,
        "w-full overflow-hidden rounded-xl border bg-card text-left transition-all",
        "hover:border-primary/40 hover:shadow-md",
        active && "border-primary ring-1 ring-primary/30"
      )}
    >
      {/* Línea principal: quién, dónde, cuándo, en qué estado */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-xs font-semibold">
          {initials(row.guestName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-base font-semibold tracking-tight">
            {row.guestName}
          </span>
          <span className="label-mono text-muted-foreground">{row.unitName}</span>
        </span>
        <span className="font-mono text-sm tabular-nums">
          {formatDay(row.checkIn)} <span className="text-muted-foreground">→</span>{" "}
          {formatDay(row.checkOut)}
          <span className="ml-2 text-xs text-muted-foreground">{row.nights}N</span>
        </span>
        <StatusBadge status={row.status} />
      </div>

      {/* Progreso de cobro: lo que más se mira después del estado */}
      {total > 0 && (
        <div className="px-4 pt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none",
                settled ? "bg-success" : "bg-primary"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="label-mono mt-1.5 flex justify-between">
            <span className="text-muted-foreground">
              Pagado{" "}
              <span className="text-foreground">
                {formatCurrency(row.paidAmount, row.currency)}
              </span>
            </span>
            <span className={settled ? "text-success" : "text-muted-foreground"}>
              {settled ? (
                "Cobrado"
              ) : (
                <>
                  Saldo{" "}
                  <span className="text-foreground">
                    {formatCurrency(balance, row.currency)}
                  </span>
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Metadatos */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-muted/30 px-4 py-2.5">
        <Meta icon={Hash} label="Código" value={row.code} mono />
        <Meta
          icon={Users}
          label="Personas"
          value={`${row.guestsCount}${row.unitCapacity ? ` / ${row.unitCapacity}` : ""}`}
        />
        <Meta
          icon={Wallet}
          label="Total"
          value={formatCurrency(row.totalAmount, row.currency)}
        />
        <Meta
          icon={Moon}
          label="Seña"
          value={formatCurrency(row.depositAmount, row.currency)}
        />
        <span className="ml-auto flex items-center gap-1.5">
          <Globe className="size-3 text-muted-foreground" />
          <SourceBadge source={row.source} />
        </span>
      </div>
    </button>
  )
}

function Meta({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="label-mono text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-medium", mono && "font-mono")}>{value}</span>
    </span>
  )
}

/* ======================== Panel lateral ======================== */

type TimelineStep = {
  icon: React.ElementType
  title: string
  detail: string | null
  done: boolean
  tone?: "success" | "destructive"
}

/**
 * Línea de tiempo construida SÓLO con datos que la base ya guarda: creación,
 * pagos acreditados, estado actual y fechas de estadía. Nada inferido ni
 * decorativo — si un evento no tiene respaldo, no aparece.
 */
function buildTimeline(row: ReservationRow, today: string): TimelineStep[] {
  const steps: TimelineStep[] = [
    {
      icon: FilePlus2,
      title: "Reserva creada",
      detail: row.createdAt.slice(0, 10),
      done: true,
    },
  ]

  const firstPaid = row.payments
    .filter((p) => p.status === "paid" && p.paidAt)
    .sort((a, b) => (a.paidAt! > b.paidAt! ? 1 : -1))[0]
  if (firstPaid) {
    steps.push({
      icon: Wallet,
      title: `Pago acreditado · ${formatCurrency(firstPaid.amount, row.currency)}`,
      detail: firstPaid.paidAt!.slice(0, 10),
      done: true,
      tone: "success",
    })
  }

  if (row.status === "cancelled" || row.status === "expired") {
    steps.push({
      icon: CircleX,
      title: row.status === "expired" ? "Expiró sin pago" : "Cancelada",
      detail: row.updatedAt.slice(0, 10),
      done: true,
      tone: "destructive",
    })
    return steps
  }

  const confirmed = row.status === "confirmed" || row.status === "completed"
  steps.push({
    icon: CircleCheck,
    title: confirmed ? "Confirmada" : "Pendiente de confirmación",
    detail: confirmed ? row.updatedAt.slice(0, 10) : null,
    done: confirmed,
  })

  steps.push({
    icon: LogIn,
    title: "Check-in",
    detail: row.checkIn,
    done: row.checkIn <= today,
  })
  steps.push({
    icon: LogOut,
    title: "Check-out",
    detail: row.checkOut,
    done: row.checkOut <= today,
  })

  return steps
}

function DetailPanel({
  row,
  today,
  onClose,
}: {
  row: ReservationRow
  today: string
  onClose: () => void
}) {
  const total = Number(row.totalAmount ?? 0)
  const balance = Math.max(0, total - row.paidAmount)
  const settled = total > 0 && balance === 0
  const steps = buildTimeline(row, today)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[400px] flex-col border-l shadow-2xl",
        "bg-card/95 backdrop-blur-xl",
        "animate-in fade-in slide-in-from-right-4 duration-300 motion-reduce:animate-none"
      )}
      aria-label={`Detalle de la reserva ${row.code}`}
    >
      <div className="flex items-start justify-between gap-3 border-b bg-muted/40 px-5 py-4">
        <div className="min-w-0">
          <p className="label-mono text-muted-foreground">{row.code}</p>
          <h2 className="mt-0.5 truncate font-heading text-lg font-semibold tracking-tight">
            {row.guestName}
          </h2>
          <p className="text-xs text-muted-foreground">
            {row.unitName} · {row.nights}N · {row.guestsCount} personas
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar">
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        {/* Resumen financiero */}
        <section className="space-y-3">
          <h3 className="label-mono text-muted-foreground">Resumen de cobro</h3>
          <div
            className={cn(
              "flex items-center justify-between rounded-xl border p-4",
              settled
                ? "border-success/40 bg-success/10"
                : "border-warning/40 bg-warning/15"
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {settled ? (
                <>
                  <CircleCheck className="size-4 text-success" /> Cobrado
                </>
              ) : (
                <>
                  <Clock3 className="size-4" /> Saldo pendiente
                </>
              )}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {formatCurrency(settled ? total : balance, row.currency)}
            </span>
          </div>
          <div className="space-y-2 rounded-xl border bg-background/60 p-4">
            <Line label="Total de la estadía" value={formatCurrency(row.totalAmount, row.currency)} />
            <Line label="Seña requerida" value={formatCurrency(row.depositAmount, row.currency)} />
            <Line label="Cobrado" value={formatCurrency(row.paidAmount, row.currency)} />
          </div>
          {row.payments.length === 0 && (
            <p className="text-xs text-muted-foreground">Sin pagos registrados todavía.</p>
          )}
        </section>

        {/* Línea de tiempo */}
        <section className="space-y-3">
          <h3 className="label-mono text-muted-foreground">Seguimiento</h3>
          <ol className="relative space-y-4 pl-1">
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-3">
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-8 left-[15px] h-[calc(100%-8px)] w-px",
                      s.done ? "bg-primary/40" : "bg-border"
                    )}
                  />
                )}
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border",
                    s.done
                      ? s.tone === "success"
                        ? "border-success/40 bg-success/15 text-success"
                        : s.tone === "destructive"
                          ? "border-destructive/40 bg-destructive/15 text-destructive"
                          : "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-muted text-muted-foreground"
                  )}
                >
                  <s.icon className="size-4" />
                </span>
                <span className="pt-1">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      !s.done && "text-muted-foreground"
                    )}
                  >
                    {s.title}
                  </span>
                  {s.detail && (
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {s.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Contacto */}
        {(row.guestPhone || row.guestEmail) && (
          <section className="space-y-2">
            <h3 className="label-mono text-muted-foreground">Contacto</h3>
            <div className="flex flex-wrap gap-2">
              {row.guestPhone && (
                <a
                  href={whatsappHref(row.guestPhone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="label-mono inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1.5 transition-colors hover:bg-success/25"
                >
                  <MessageCircle className="size-3" /> WhatsApp
                </a>
              )}
              {row.guestEmail && (
                <a
                  href={`mailto:${row.guestEmail}`}
                  className="label-mono inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{row.guestEmail}</span>
                </a>
              )}
            </div>
          </section>
        )}

        {row.notes && (
          <section className="space-y-2">
            <h3 className="label-mono text-muted-foreground">Observaciones</h3>
            <p className="rounded-xl border bg-background/60 p-3 text-sm whitespace-pre-wrap">
              {row.notes}
            </p>
          </section>
        )}

        {/* Cambios de estado: sólo las transiciones válidas (lib/constants). */}
        <section className="space-y-2">
          <h3 className="label-mono text-muted-foreground">Cambiar estado</h3>
          <StatusControl id={row.id} status={row.status} />
        </section>
      </div>

      <div className="border-t bg-muted/40 p-4">
        <Link
          href={`/reservas/${row.id}`}
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          <ExternalLink /> Abrir ficha completa
        </Link>
      </div>
    </aside>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </div>
  )
}
