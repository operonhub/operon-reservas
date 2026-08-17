import Link from "next/link"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge, SourceBadge } from "@/components/reservations/reservation-badges"
import { NewReservationDialog } from "@/components/reservations/new-reservation-dialog"
import { FilterBar } from "@/components/reservations/filter-bar"
import { formatCurrency, todayISO } from "@/lib/format"

type PaymentRow = { amount: number; status: string }

/** Etiqueta de estado de pago derivada de los pagos de la reserva (no hay
 *  columna propia: se calcula igual que en el detalle de la reserva). */
function paymentStatusLabel(payments: PaymentRow[]): { label: string; className: string } {
  if (payments.length === 0) return { label: "—", className: "text-muted-foreground" }
  if (payments.some((p) => p.status === "paid"))
    return { label: "Pagado", className: "text-emerald-700 dark:text-emerald-400" }
  if (payments.some((p) => p.status === "pending"))
    return { label: "Pendiente", className: "text-amber-700 dark:text-amber-400" }
  return { label: "Rechazado", className: "text-destructive" }
}

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>
}) {
  const { f = "proximas" } = await searchParams
  const ctx = await requireContext()
  const supabase = await createClient()
  const today = todayISO()

  let query = supabase
    .from("reservations")
    .select(
      "id, code, check_in, check_out, guests_count, status, source, total_amount, deposit_amount, currency, guests(full_name), units(name), payments(amount, status)"
    )

  switch (f) {
    case "pendientes":
      query = query.in("status", ["inquiry", "pending", "pending_payment"])
      break
    case "confirmadas":
      query = query.eq("status", "confirmed")
      break
    case "canceladas":
      query = query.eq("status", "cancelled")
      break
    case "expiradas":
      query = query.eq("status", "expired")
      break
    case "finalizadas":
      query = query.eq("status", "completed")
      break
    case "todas":
      break
    default: // proximas
      query = query.gte("check_in", today).not("status", "in", "(cancelled,expired)")
  }

  const [{ data: reservations }, { data: units }] = await Promise.all([
    query.order("check_in", { ascending: true }).limit(200),
    supabase
      .from("units")
      .select("id, name, capacity")
      .eq("is_active", true)
      .order("position"),
  ])

  const list = reservations ?? []

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Reservas</h1>
          <p className="text-sm text-muted-foreground">{ctx.organizationName}</p>
        </div>
        {(units ?? []).length > 0 && <NewReservationDialog units={units ?? []} />}
      </header>

      <FilterBar active={f} />

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No hay reservas en este filtro.
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="label-mono text-muted-foreground">Código</TableHead>
                <TableHead className="label-mono text-muted-foreground">Huésped</TableHead>
                <TableHead className="label-mono text-muted-foreground">Unidad</TableHead>
                <TableHead className="label-mono text-muted-foreground">Fechas</TableHead>
                <TableHead className="label-mono text-center text-muted-foreground">Pers.</TableHead>
                <TableHead className="label-mono text-right text-muted-foreground">Total</TableHead>
                <TableHead className="label-mono text-right text-muted-foreground">Seña</TableHead>
                <TableHead className="label-mono text-right text-muted-foreground">Pagado</TableHead>
                <TableHead className="label-mono text-right text-muted-foreground">Saldo</TableHead>
                <TableHead className="label-mono text-muted-foreground">Pago</TableHead>
                <TableHead className="label-mono text-muted-foreground">Origen</TableHead>
                <TableHead className="label-mono text-muted-foreground">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => {
                const guest = r.guests as { full_name: string } | { full_name: string }[] | null
                const guestName = Array.isArray(guest) ? guest[0]?.full_name : guest?.full_name
                const unit = r.units as { name: string } | { name: string }[] | null
                const unitName = Array.isArray(unit) ? unit[0]?.name : unit?.name
                const payments = (r.payments as PaymentRow[] | null) ?? []
                const paid = payments
                  .filter((p) => p.status === "paid")
                  .reduce((s, p) => s + Number(p.amount), 0)
                const balance = r.total_amount != null ? Number(r.total_amount) - paid : null
                const payStatus = paymentStatusLabel(payments)
                return (
                  <TableRow key={r.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/reservas/${r.id}`} className="hover:underline">
                        {r.code}
                      </Link>
                    </TableCell>
                    <TableCell>{guestName ?? "—"}</TableCell>
                    <TableCell>{unitName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.check_in} → {r.check_out}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{r.guests_count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.total_amount, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(r.deposit_amount, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(paid, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(balance, r.currency)}
                    </TableCell>
                    <TableCell className={payStatus.className}>{payStatus.label}</TableCell>
                    <TableCell>
                      <SourceBadge source={r.source} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
