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
      "id, code, check_in, check_out, guests_count, status, source, total_amount, currency, guests(full_name), units(name)"
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
    case "finalizadas":
      query = query.eq("status", "completed")
      break
    case "todas":
      break
    default: // proximas
      query = query
        .gte("check_in", today)
        .neq("status", "cancelled")
        .neq("status", "expired")
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
                <TableHead>Código</TableHead>
                <TableHead>Huésped</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead>Fechas</TableHead>
                <TableHead className="text-center">Pers.</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => {
                const guest = r.guests as { full_name: string } | { full_name: string }[] | null
                const guestName = Array.isArray(guest) ? guest[0]?.full_name : guest?.full_name
                const unit = r.units as { name: string } | { name: string }[] | null
                const unitName = Array.isArray(unit) ? unit[0]?.name : unit?.name
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
