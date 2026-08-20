import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { AvailabilityCalendar } from "@/components/availability/availability-calendar"
import {
  todayISO,
  nightsBetween,
  startOfMonth,
  addMonths,
} from "@/lib/format"
import type { Enums } from "@/lib/supabase/types"

/**
 * Se carga un rango largo de una sola vez (un año para atrás y otro para
 * adelante) para que moverse por el calendario sea instantáneo: navegar de mes
 * es scrollear, no volver a consultar. Para un alojamiento son pocos cientos
 * de filas, y el fondo de la grilla no cuesta DOM (ver `rowBackground`).
 */
const MONTHS_BACK = 12
const MONTHS_FORWARD = 13

// daterange en texto: "[2026-09-10,2026-09-13)" -> { start, endExclusive }
function parseRange(raw: string): { start: string; endExclusive: string } | null {
  const m = raw.match(/\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)/)
  return m ? { start: m[1], endExclusive: m[2] } : null
}

export type CalendarSegment = {
  id: string
  unitId: string
  unitName: string
  start: string
  endExclusive: string
  kind: Enums<"occupancy_kind">
  /** Nombre del huésped, o motivo si es un bloqueo. */
  label: string
  reservationId: string | null
  code: string | null
  status: Enums<"reservation_status"> | null
  guestsCount: number | null
  guestEmail: string | null
  guestPhone: string | null
  totalAmount: number | null
  depositAmount: number | null
  paidAmount: number
  currency: string
  nights: number
}

export default async function CalendarioPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const today = todayISO()
  const start = addMonths(startOfMonth(today), -MONTHS_BACK)
  const end = addMonths(startOfMonth(today), MONTHS_FORWARD)

  const [{ data: units }, { data: occ }, { data: property }] = await Promise.all([
    supabase
      .from("units")
      .select("id, name, capacity")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("unit_occupancy")
      // Filtra en la base por solape con la ventana, en vez de traer todo
      // el histórico y descartarlo en JS.
      .select(
        "id, unit_id, during, kind, block_reason, reservations(id, code, status, guests_count, total_amount, deposit_amount, currency, guests(full_name, email, phone), payments(amount, status, kind))"
      )
      .overlaps("during", `[${start},${end})`),
    supabase.from("properties").select("currency").limit(1).maybeSingle(),
  ])

  const unitById = new Map((units ?? []).map((u) => [u.id, u]))
  const currency = property?.currency ?? "ARS"

  type Res = {
    id: string
    code: string
    status: Enums<"reservation_status">
    guests_count: number
    total_amount: number | null
    deposit_amount: number | null
    currency: string
    guests: { full_name: string; email: string | null; phone: string | null } | null
    payments: { amount: number; status: string; kind: string }[] | null
  }

  const segments: CalendarSegment[] = (occ ?? [])
    .map((o): CalendarSegment | null => {
      const r = parseRange(o.during as unknown as string)
      if (!r) return null
      const unit = unitById.get(o.unit_id)
      if (!unit) return null

      const raw = o.reservations as Res | Res[] | null
      const res = Array.isArray(raw) ? raw[0] : raw
      const gRaw = res?.guests
      const guest = Array.isArray(gRaw) ? gRaw[0] : gRaw

      const base = {
        id: o.id,
        unitId: o.unit_id,
        unitName: unit.name,
        start: r.start,
        endExclusive: r.endExclusive,
        kind: o.kind,
        nights: nightsBetween(r.start, r.endExclusive),
      }

      if (o.kind === "block") {
        return {
          ...base,
          label: o.block_reason || "Bloqueo",
          reservationId: null,
          code: null,
          status: null,
          guestsCount: null,
          guestEmail: null,
          guestPhone: null,
          totalAmount: null,
          depositAmount: null,
          paidAmount: 0,
          currency,
        }
      }

      const paid = (res?.payments ?? [])
        .filter((p) => p.status === "paid")
        .reduce((s, p) => s + Number(p.amount), 0)

      return {
        ...base,
        // El nombre del huésped es lo que el dueño busca de un vistazo.
        label: guest?.full_name ?? res?.code ?? "Reserva",
        reservationId: res?.id ?? null,
        code: res?.code ?? null,
        status: res?.status ?? null,
        guestsCount: res?.guests_count ?? null,
        guestEmail: guest?.email ?? null,
        guestPhone: guest?.phone ?? null,
        totalAmount: res?.total_amount ?? null,
        depositAmount: res?.deposit_amount ?? null,
        paidAmount: paid,
        currency: res?.currency ?? currency,
      }
    })
    .filter((s): s is CalendarSegment => s !== null)

  // Los KPIs se calculan en el cliente, por mes visible: dependen de hacia
  // dónde scrolleó el usuario, no del rango que se trajo de la base.
  return (
    <AvailabilityCalendar
      organizationName={ctx.organizationName}
      units={units ?? []}
      segments={segments}
      rangeStart={start}
      rangeDays={nightsBetween(start, end)}
      currency={currency}
    />
  )
}
