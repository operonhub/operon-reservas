import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { AvailabilityCalendar } from "@/components/availability/availability-calendar"
import { todayISO, addDays } from "@/lib/format"
import { RESERVATION_STATUS_LABELS } from "@/lib/constants"
import type { Enums } from "@/lib/supabase/types"

const WINDOW_DAYS = 30

// daterange en texto: "[2026-09-10,2026-09-13)" -> { start, endExclusive }
function parseRange(raw: string): { start: string; endExclusive: string } | null {
  const m = raw.match(/\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)/)
  return m ? { start: m[1], endExclusive: m[2] } : null
}

export type CalendarSegment = {
  id: string
  unitId: string
  start: string
  endExclusive: string
  kind: Enums<"occupancy_kind">
  label: string
}

export default async function CalendarioPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const start = todayISO()
  const end = addDays(start, WINDOW_DAYS)

  const [{ data: units }, { data: occ }] = await Promise.all([
    supabase
      .from("units")
      .select("id, name, capacity")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("unit_occupancy")
      .select("id, unit_id, during, kind, block_reason, reservations(code, status)"),
  ])

  const segments: CalendarSegment[] = (occ ?? [])
    .map((o) => {
      const r = parseRange(o.during as unknown as string)
      if (!r) return null
      // filtrar a la ventana visible
      if (r.endExclusive <= start || r.start >= end) return null
      const res = o.reservations as
        | { code: string; status: Enums<"reservation_status"> }
        | { code: string; status: Enums<"reservation_status"> }[]
        | null
      const resObj = Array.isArray(res) ? res[0] : res
      const label =
        o.kind === "block"
          ? o.block_reason || "Bloqueo"
          : resObj
            ? `${resObj.code} · ${RESERVATION_STATUS_LABELS[resObj.status]}`
            : "Reserva"
      return {
        id: o.id,
        unitId: o.unit_id,
        start: r.start,
        endExclusive: r.endExclusive,
        kind: o.kind,
        label,
      }
    })
    .filter((s): s is CalendarSegment => s !== null)

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Calendario</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.organizationName} — disponibilidad de los próximos {WINDOW_DAYS} días
        </p>
      </header>

      <AvailabilityCalendar
        units={units ?? []}
        segments={segments}
        startDate={start}
        days={WINDOW_DAYS}
      />
    </div>
  )
}
