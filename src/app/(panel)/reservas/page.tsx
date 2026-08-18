import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { NewReservationDialog } from "@/components/reservations/new-reservation-dialog"
import { FilterBar } from "@/components/reservations/filter-bar"
import { ReservationsBoard, type ReservationRow } from "@/components/reservations/reservations-board"
import { OperonArc } from "@/components/brand/operon-arc"
import { ENTER } from "@/lib/motion"
import { todayISO, nightsBetween } from "@/lib/format"
import type { Enums } from "@/lib/supabase/types"

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
      "id, code, check_in, check_out, guests_count, status, source, total_amount, deposit_amount, currency, notes, created_at, updated_at, guests(id, full_name, email, phone), units(name, capacity), payments(amount, status, kind, paid_at)"
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

  type Guest = {
    id: string
    full_name: string
    email: string | null
    phone: string | null
  }
  type Unit = { name: string; capacity: number }
  type Payment = {
    amount: number
    status: string
    kind: string
    paid_at: string | null
  }

  const rows: ReservationRow[] = (reservations ?? []).map((r) => {
    const gRaw = r.guests as Guest | Guest[] | null
    const guest = Array.isArray(gRaw) ? gRaw[0] : gRaw
    const uRaw = r.units as Unit | Unit[] | null
    const unit = Array.isArray(uRaw) ? uRaw[0] : uRaw
    const payments = (r.payments as Payment[] | null) ?? []
    const paid = payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + Number(p.amount), 0)

    return {
      id: r.id,
      code: r.code,
      status: r.status as Enums<"reservation_status">,
      source: r.source as Enums<"reservation_source">,
      checkIn: r.check_in,
      checkOut: r.check_out,
      nights: nightsBetween(r.check_in, r.check_out),
      guestsCount: r.guests_count,
      guestId: guest?.id ?? null,
      guestName: guest?.full_name ?? "—",
      guestEmail: guest?.email ?? null,
      guestPhone: guest?.phone ?? null,
      unitName: unit?.name ?? "—",
      unitCapacity: unit?.capacity ?? null,
      totalAmount: r.total_amount,
      depositAmount: r.deposit_amount,
      paidAmount: paid,
      currency: r.currency,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      payments: payments.map((p) => ({
        amount: Number(p.amount),
        status: p.status,
        kind: p.kind,
        paidAt: p.paid_at,
      })),
    }
  })

  return (
    <div className="relative p-6 space-y-5">
      <OperonArc className="inset-0" size={560} thickness={70} corner="bottom-right" />

      <header className={`${ENTER} flex flex-wrap items-end justify-between gap-4`}>
        <div>
          <p className="label-mono text-primary">{ctx.organizationName}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold">Reservas</h1>
        </div>
        {(units ?? []).length > 0 && <NewReservationDialog units={units ?? []} />}
      </header>

      <div className={ENTER}>
        <FilterBar active={f} />
      </div>

      <ReservationsBoard rows={rows} today={today} />
    </div>
  )
}
