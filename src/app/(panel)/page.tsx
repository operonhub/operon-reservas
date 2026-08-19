import type { ElementType } from "react"
import Link from "next/link"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { StatusBadge } from "@/components/reservations/reservation-badges"
import { NewReservationDialog } from "@/components/reservations/new-reservation-dialog"
import { OperonArc } from "@/components/brand/operon-arc"
import {
  OperonMarkPapel,
  OperonMarkTinta,
} from "@/components/brand/operon-mark"
import { HOLDING_STATUSES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import {
  addDays,
  formatCurrency,
  formatDay,
  initials,
  todayISO,
} from "@/lib/format"
import { ENTER, ENTER_UP, stagger } from "@/lib/motion"
import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  CircleCheck,
  Clock3,
  LogIn,
  LogOut,
  WalletCards,
} from "lucide-react"
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

type AgendaItem = ResRow & {
  movement: "check-in" | "check-out"
  time: string
}

function guestName(rel: ResRow["guests"]) {
  return (Array.isArray(rel) ? rel[0]?.full_name : rel?.full_name) ?? "—"
}

function unitName(rel: ResRow["units"]) {
  return (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? "—"
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0]?.split("@")[0] || "Hola"
}

function longDate(iso: string) {
  const formatted = new Date(`${iso}T12:00:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function nextMonthStart(iso: string) {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`
}

function quantity(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`
}

export default async function InicioPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const today = todayISO()
  const tomorrow = addDays(today, 1)
  const horizon = addDays(today, HORIZON)
  const monthStart = `${today.slice(0, 8)}01`
  const monthEnd = nextMonthStart(today)
  const resSelect =
    "id, code, check_in, check_out, status, guests(full_name), units(name)"

  const [
    { data: property },
    { count: pending },
    { data: activeUnits },
    { data: checkinsToday },
    { data: checkoutsToday },
    { data: upcomingArrivals },
    { data: occupancyToday },
    { data: paidThisMonth },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("currency, checkin_time, checkout_time")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .in("status", ["inquiry", "pending", "pending_payment"]),
    supabase
      .from("units")
      .select("id, name, capacity")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("reservations")
      .select(resSelect)
      .in("status", HOLDING_STATUSES)
      .eq("check_in", today)
      .order("code", { ascending: true }),
    supabase
      .from("reservations")
      .select(resSelect)
      .in("status", HOLDING_STATUSES)
      .eq("check_out", today)
      .order("code", { ascending: true }),
    supabase
      .from("reservations")
      .select(resSelect)
      .in("status", HOLDING_STATUSES)
      .gte("check_in", tomorrow)
      .lte("check_in", horizon)
      .order("check_in", { ascending: true })
      .limit(5),
    supabase
      .from("unit_occupancy")
      .select("unit_id, kind")
      .overlaps("during", `[${today},${tomorrow})`),
    supabase
      .from("payments")
      .select("amount, currency")
      .eq("status", "paid")
      .gte("paid_at", `${monthStart}T00:00:00`)
      .lt("paid_at", `${monthEnd}T00:00:00`),
  ])

  const units = activeUnits ?? []
  const totalUnits = units.length
  const currency = property?.currency ?? "ARS"
  const checkinTime = property?.checkin_time?.slice(0, 5) ?? "14:00"
  const checkoutTime = property?.checkout_time?.slice(0, 5) ?? "10:00"

  const occupiedIds = new Set(
    (occupancyToday ?? [])
      .filter((row) => row.kind === "reservation")
      .map((row) => row.unit_id)
  )
  const blockedIds = new Set(
    (occupancyToday ?? [])
      .filter((row) => row.kind === "block")
      .map((row) => row.unit_id)
  )
  const occupied = occupiedIds.size
  const blocked = blockedIds.size
  const available = Math.max(0, totalUnits - occupied - blocked)
  const occupancyPct = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0

  const collected = (paidThisMonth ?? [])
    .filter((payment) => payment.currency === currency)
    .reduce((sum, payment) => sum + Number(payment.amount), 0)

  const checkins = (checkinsToday ?? []) as ResRow[]
  const checkouts = (checkoutsToday ?? []) as ResRow[]
  const agenda: AgendaItem[] = [
    ...checkouts.map((row) => ({
      ...row,
      movement: "check-out" as const,
      time: checkoutTime,
    })),
    ...checkins.map((row) => ({
      ...row,
      movement: "check-in" as const,
      time: checkinTime,
    })),
  ].sort(
    (a, b) =>
      a.time.localeCompare(b.time) ||
      (a.movement === b.movement ? 0 : a.movement === "check-out" ? -1 : 1)
  )

  const availabilityCaption =
    totalUnits === 0
      ? "Sin unidades activas"
      : blocked > 0
        ? `${quantity(available, "libre", "libres")} · ${quantity(blocked, "bloqueada", "bloqueadas")}`
        : `${quantity(available, "libre", "libres")} · sin bloqueos`

  return (
    <div className="relative min-h-full overflow-hidden p-4 sm:p-6 lg:p-8">
      <OperonArc
        className="inset-0"
        size={660}
        thickness={78}
        corner="bottom-right"
      />

      <div className="relative mx-auto max-w-7xl">
        <div className="relative">
          <header
            className={cn(
              ENTER,
              "relative min-h-[280px] overflow-hidden rounded-[1.75rem] bg-foreground px-5 pt-6 pb-20 text-background shadow-xl shadow-foreground/10 sm:px-8 sm:pt-8 sm:pb-24 lg:px-10"
            )}
            style={stagger(0)}
          >
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 82% 12%, color-mix(in oklch, var(--warning) 26%, transparent), transparent 34%)",
              }}
            />
            <div
              aria-hidden
              className="absolute -top-36 -right-24 size-96 rounded-full border border-background/10"
            />

            <div className="relative z-10 max-w-2xl pr-0 md:pr-48">
              <p className="label-mono text-background/65">
                OPERON RESERVAS · {ctx.organizationName}
              </p>
              <h1 className="mt-5 max-w-xl text-[clamp(2.25rem,5vw,4.5rem)] leading-[0.94] font-semibold tracking-[-0.055em] text-balance">
                Buen día, {firstName(ctx.fullName)}.
              </h1>
              <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-1">
                <p className="text-base font-medium text-background/90 sm:text-lg">
                  Esto es lo importante de hoy.
                </p>
                <p className="label-mono text-background/55">{longDate(today)}</p>
              </div>

              <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-center">
                {units.length > 0 && <NewReservationDialog units={units} />}
                <Link
                  href="/calendario"
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "border-background/25 bg-background/10 text-background hover:bg-background/20 hover:text-background dark:border-background/25 dark:bg-background/10 dark:hover:bg-background/20"
                  )}
                >
                  <CalendarDays /> Ver calendario
                </Link>
              </div>
            </div>

            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 -right-8 -translate-y-1/2 opacity-[0.12] md:right-10 md:opacity-100"
            >
              <OperonMarkPapel className="h-64 w-44 drop-shadow-2xl dark:hidden" />
              <OperonMarkTinta className="hidden h-64 w-44 drop-shadow-2xl dark:block" />
            </div>
          </header>

          <section
            aria-label="Resumen operativo"
            className="relative z-20 -mt-14 grid gap-3 px-3 sm:grid-cols-2 sm:px-5 xl:grid-cols-4 xl:px-8"
          >
            <MetricCard
              label="Ocupación hoy"
              value={`${occupied}/${totalUnits}`}
              caption={availabilityCaption}
              icon={BedDouble}
              progress={occupancyPct}
              href="/calendario"
              delayIndex={1}
            />
            <MetricCard
              label="Pendientes"
              value={String(pending ?? 0)}
              caption={(pending ?? 0) > 0 ? "Requieren revisión" : "Todo al día"}
              icon={Clock3}
              tone={(pending ?? 0) > 0 ? "warning" : "default"}
              href="/reservas?f=pendientes"
              delayIndex={2}
            />
            <MetricCard
              label="Check-ins hoy"
              value={String(checkins.length)}
              caption={quantity(checkins.length, "llegada programada", "llegadas programadas")}
              icon={LogIn}
              tone="primary"
              href="#agenda-hoy"
              delayIndex={3}
            />
            <MetricCard
              label="Cobrado del mes"
              value={formatCurrency(collected, currency)}
              caption="Pagos acreditados"
              icon={WalletCards}
              delayIndex={4}
            />
          </section>
        </div>

        <section className="mt-6 grid gap-5 lg:grid-cols-12">
          <TodayAgenda items={agenda} delayIndex={5} />
          <UpcomingArrivals
            rows={(upcomingArrivals ?? []) as ResRow[]}
            horizon={HORIZON}
            delayIndex={6}
          />
        </section>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  caption,
  icon: Icon,
  progress,
  href,
  tone = "default",
  delayIndex,
}: {
  label: string
  value: string
  caption: string
  icon: ElementType
  progress?: number
  href?: string
  tone?: "default" | "primary" | "warning"
  delayIndex: number
}) {
  const card = (
    <Card
      className={cn(
        ENTER_UP,
        "min-h-36 gap-0 border-0 py-4 shadow-lg shadow-foreground/[0.06] ring-1 transition-all",
        href &&
          "group-hover:-translate-y-0.5 group-hover:shadow-xl group-focus-visible:ring-3 group-focus-visible:ring-ring/50 motion-reduce:group-hover:translate-y-0",
        tone === "primary"
          ? "bg-primary/[0.08] ring-primary/25"
          : tone === "warning"
            ? "bg-warning/10 ring-warning/45"
            : "ring-foreground/10"
      )}
      style={stagger(delayIndex, 55)}
    >
      <CardContent className="flex h-full flex-col px-4">
        <div className="flex items-start justify-between gap-3">
          <p className="label-mono text-muted-foreground">{label}</p>
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
              tone === "primary" && "bg-primary/15 text-primary",
              tone === "warning" && "bg-warning/25 text-foreground"
            )}
          >
            <Icon className="size-4" />
          </span>
        </div>
        <p className="mt-2 font-mono text-[clamp(1.6rem,3vw,2.15rem)] leading-none font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {progress !== undefined && (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 motion-reduce:transition-none"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
        <p
          className={cn(
            "mt-auto pt-3 text-xs text-muted-foreground",
            progress !== undefined && "pt-2"
          )}
        >
          {caption}
        </p>
      </CardContent>
    </Card>
  )

  return href ? (
    <Link href={href} className="group rounded-xl outline-none">
      {card}
    </Link>
  ) : (
    card
  )
}

function TodayAgenda({ items, delayIndex }: { items: AgendaItem[]; delayIndex: number }) {
  return (
    <Card
      id="agenda-hoy"
      className={cn(ENTER_UP, "scroll-mt-6 gap-0 py-0 lg:col-span-7")}
      style={stagger(delayIndex)}
    >
      <CardHeader className="border-b py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="label-mono text-primary">Operación</p>
            <CardTitle className="mt-1 text-lg">Agenda de hoy</CardTitle>
          </div>
          <span className="label-mono rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            {quantity(items.length, "movimiento", "movimientos")}
          </span>
        </div>
      </CardHeader>

      {items.length === 0 ? (
        <CardContent className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-success/15 text-success">
            <CircleCheck className="size-5" />
          </span>
          <p className="mt-4 font-heading text-base font-semibold">Jornada despejada</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            No hay ingresos ni salidas programadas para hoy.
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <AgendaRow key={`${item.movement}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const isCheckin = item.movement === "check-in"
  const person = guestName(item.guests)

  return (
    <li>
      <Link
        href={`/reservas/${item.id}`}
        className="group grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none sm:grid-cols-[3.25rem_minmax(0,1fr)_auto]"
      >
        <time className="font-mono text-sm font-semibold tabular-nums" dateTime={item.time}>
          {item.time}
        </time>

        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-xs font-semibold">
            {initials(person)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-heading text-sm font-semibold transition-colors group-hover:text-primary">
              {person}
            </span>
            <span className="label-mono block truncate text-muted-foreground">
              {unitName(item.units)} · {item.code}
            </span>
          </span>
        </span>

        <span className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
          <span
            className={cn(
              "label-mono inline-flex items-center gap-1 rounded-full px-2 py-1",
              isCheckin
                ? "bg-primary/12 text-primary"
                : "bg-warning/20 text-foreground"
            )}
          >
            {isCheckin ? <LogIn className="size-3" /> : <LogOut className="size-3" />}
            {isCheckin ? "Ingreso" : "Salida"}
          </span>
          <StatusBadge status={item.status} />
        </span>
      </Link>
    </li>
  )
}

function UpcomingArrivals({
  rows,
  horizon,
  delayIndex,
}: {
  rows: ResRow[]
  horizon: number
  delayIndex: number
}) {
  return (
    <Card
      className={cn(ENTER_UP, "gap-0 py-0 lg:col-span-5")}
      style={stagger(delayIndex)}
    >
      <CardHeader className="border-b py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="label-mono text-primary">Próximos {horizon} días</p>
            <CardTitle className="mt-1 text-lg">Próximas llegadas</CardTitle>
          </div>
          <Link
            href="/reservas"
            className="label-mono inline-flex items-center gap-1 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Ver reservas <ArrowRight className="size-3" />
          </Link>
        </div>
      </CardHeader>

      {rows.length === 0 ? (
        <CardContent className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CalendarDays className="size-5" />
          </span>
          <p className="mt-4 font-heading text-base font-semibold">Sin llegadas próximas</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            No hay check-ins programados en este período.
          </p>
        </CardContent>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => {
            const person = guestName(row.guests)
            return (
              <li key={row.id}>
                <Link
                  href={`/reservas/${row.id}`}
                  className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none"
                >
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-muted px-1.5 py-2 text-center">
                    <span className="font-mono text-sm leading-none font-semibold tabular-nums">
                      {row.check_in.slice(8, 10)}
                    </span>
                    <span className="label-mono mt-1 text-muted-foreground">
                      {formatDay(row.check_in).split(" ").at(-1)}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-heading text-sm font-semibold transition-colors group-hover:text-primary">
                      {person}
                    </span>
                    <span className="label-mono block truncate text-muted-foreground">
                      {unitName(row.units)} · {row.code}
                    </span>
                  </span>
                  <StatusBadge status={row.status} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
