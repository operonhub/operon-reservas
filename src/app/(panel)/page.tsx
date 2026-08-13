import Link from "next/link"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/reservations/reservation-badges"
import { formatCurrency, todayISO, addDays } from "@/lib/format"
import { CalendarCheck, CalendarX, Clock, TrendingUp } from "lucide-react"
import type { Enums } from "@/lib/supabase/types"

const HORIZON = 14

type ResRow = {
  id: string
  code: string
  check_in: string
  check_out: string
  status: Enums<"reservation_status">
  guests: { full_name: string } | { full_name: string }[] | null
  units: { name: string } | { name: string }[] | null
}

function name(rel: { full_name: string } | { full_name: string }[] | null) {
  return (Array.isArray(rel) ? rel[0]?.full_name : rel?.full_name) ?? "—"
}
function unitName(rel: { name: string } | { name: string }[] | null) {
  return (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? "—"
}

export default async function InicioPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const today = todayISO()
  const horizon = addDays(today, HORIZON)
  const monthStart = today.slice(0, 8) + "01"
  const monthEnd = addDays(monthStart.slice(0, 8) + "01", 31).slice(0, 8) + "01"

  const holding: Enums<"reservation_status">[] = ["pending", "pending_payment", "confirmed", "completed"]
  const resSelect = "id, code, check_in, check_out, status, guests(full_name), units(name)"

  const [
    { count: pendientes },
    { data: unitsActive },
    { data: checkins },
    { data: checkouts },
    { data: occToday },
    { data: revenueRows },
  ] = await Promise.all([
    supabase
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .in("status", ["inquiry", "pending", "pending_payment"]),
    supabase.from("units").select("id").eq("is_active", true),
    supabase
      .from("reservations")
      .select(resSelect)
      .in("status", holding)
      .gte("check_in", today)
      .lte("check_in", horizon)
      .order("check_in", { ascending: true })
      .limit(6),
    supabase
      .from("reservations")
      .select(resSelect)
      .in("status", holding)
      .gte("check_out", today)
      .lte("check_out", horizon)
      .order("check_out", { ascending: true })
      .limit(6),
    supabase
      .from("unit_occupancy")
      .select("unit_id")
      .overlaps("during", `[${today},${addDays(today, 1)})`),
    supabase
      .from("reservations")
      .select("total_amount")
      .in("status", ["confirmed", "completed"])
      .gte("check_in", monthStart)
      .lt("check_in", monthEnd),
  ])

  const totalUnits = (unitsActive ?? []).length
  const occupiedToday = new Set((occToday ?? []).map((o) => o.unit_id)).size
  const revenue = (revenueRows ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0)

  const stats = [
    { label: "Reservas pendientes", value: String(pendientes ?? 0), icon: Clock },
    { label: "Check-ins (14 días)", value: String((checkins ?? []).length), icon: CalendarCheck },
    { label: "Ocupación hoy", value: `${occupiedToday}/${totalUnits}`, icon: CalendarX },
    { label: "Ingresos confirmados (mes)", value: formatCurrency(revenue), icon: TrendingUp },
  ]

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Inicio</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.organizationName} — resumen operativo
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <UpcomingCard
          title="Próximos check-ins"
          rows={(checkins ?? []) as ResRow[]}
          dateKey="check_in"
          empty="No hay ingresos en los próximos 14 días."
        />
        <UpcomingCard
          title="Próximos check-outs"
          rows={(checkouts ?? []) as ResRow[]}
          dateKey="check_out"
          empty="No hay salidas en los próximos 14 días."
        />
      </div>
    </div>
  )
}

function UpcomingCard({
  title,
  rows,
  dateKey,
  empty,
}: {
  title: string
  rows: ResRow[]
  dateKey: "check_in" | "check_out"
  empty: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/reservas/${r.id}`} className="font-medium hover:underline">
                  {name(r.guests)}
                </Link>
                <span className="text-muted-foreground">
                  {unitName(r.units)} · {r[dateKey]}
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
