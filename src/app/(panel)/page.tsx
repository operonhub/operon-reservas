import Link from "next/link"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/reservations/reservation-badges"
import { formatCurrency, todayISO, addDays } from "@/lib/format"
import { CalendarCheck, Clock, TrendingUp } from "lucide-react"
import { ENTER, ENTER_UP, stagger } from "@/lib/motion"
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

  // Jerarquía deliberada: la ocupación de hoy es LA pregunta operativa del
  // día, así que va en un tile dominante. El resto son de apoyo y pesan menos.
  const occupancyPct = totalUnits > 0 ? Math.round((occupiedToday / totalUnits) * 100) : 0

  const secondary = [
    { label: "Pendientes", value: String(pendientes ?? 0), icon: Clock },
    { label: "Check-ins · 14 días", value: String((checkins ?? []).length), icon: CalendarCheck },
    { label: "Ingresos del mes", value: formatCurrency(revenue), icon: TrendingUp },
  ]

  return (
    <div className="p-6 space-y-6">
      <header className={ENTER} style={stagger(0)}>
        <p className="label-mono text-muted-foreground">{ctx.organizationName}</p>
        <h1 className="mt-1 text-2xl font-semibold">Inicio</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Héroe */}
        <Card
          className={`${ENTER_UP} bg-primary text-primary-foreground lg:col-span-1 lg:row-span-1`}
          style={stagger(1)}
        >
          <CardContent className="pt-6">
            <p className="label-mono opacity-80">Ocupación hoy</p>
            <p className="mt-2 font-mono text-5xl font-medium tabular-nums">
              {occupiedToday}
              <span className="text-2xl opacity-60">/{totalUnits}</span>
            </p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-primary-foreground/20">
              <div
                className="h-full rounded-full bg-primary-foreground/80 transition-[width] duration-700 motion-reduce:transition-none"
                style={{ width: `${occupancyPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs opacity-70">
              {occupancyPct}% de las unidades activas
            </p>
          </CardContent>
        </Card>

        {/* Apoyo */}
        <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          {secondary.map((s, i) => (
            <Card key={s.label} className={ENTER_UP} style={stagger(i + 2)}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <p className="label-mono text-muted-foreground">{s.label}</p>
                  <s.icon className="size-3.5 text-muted-foreground" />
                </div>
                <p className="mt-2 font-mono text-2xl font-medium tabular-nums">
                  {s.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <UpcomingCard
          title="Próximos check-ins"
          rows={(checkins ?? []) as ResRow[]}
          dateKey="check_in"
          empty="No hay ingresos en los próximos 14 días."
          delayIndex={5}
        />
        <UpcomingCard
          title="Próximos check-outs"
          rows={(checkouts ?? []) as ResRow[]}
          dateKey="check_out"
          empty="No hay salidas en los próximos 14 días."
          delayIndex={6}
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
  delayIndex,
}: {
  title: string
  rows: ResRow[]
  dateKey: "check_in" | "check_out"
  empty: string
  delayIndex: number
}) {
  return (
    <Card className={ENTER_UP} style={stagger(delayIndex)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/reservas/${r.id}`}
                  className="font-medium transition-colors hover:text-primary"
                >
                  {name(r.guests)}
                </Link>
                <span className="text-muted-foreground">
                  {unitName(r.units)} ·{" "}
                  <span className="font-mono tabular-nums">{r[dateKey]}</span>
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
