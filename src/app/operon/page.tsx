import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRight, UserPlus } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { activity, relative, shortDate } from "@/lib/operon/format"
import type { ClientRow } from "@/lib/operon/types"
import { TONE_CLASSES, overviewSummary, type ZoneOverview } from "@/lib/operon/zone"
import { isIcalProblem, type IcalStatusRow } from "@/lib/operon/ical"
import { WEBSITE_STATUS, type WebsiteStatus } from "@/lib/operon/website"
import { siteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { MpBadge } from "./badges"

export const metadata: Metadata = {
  title: "Clientes · Operon",
  robots: { index: false, follow: false },
}

// Fuera del componente: la regla de pureza de React no deja leer el reloj
// directo en el render.
function currentTime() {
  return Date.now()
}

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "activos", label: "Activos" },
  { key: "suspendidos", label: "Suspendidos" },
  { key: "problemas", label: "Con problemas" },
] as const
type Filter = (typeof FILTERS)[number]["key"]

function matches(filter: Filter, c: ClientRow, hasProblems: (c: ClientRow) => boolean) {
  if (filter === "activos") return !c.suspended_at
  if (filter === "suspendidos") return Boolean(c.suspended_at)
  if (filter === "problemas") return hasProblems(c)
  return true
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>
}) {
  const supabase = await createClient()
  const [{ data, error }, { data: zoneData }, { data: icalData }, { data: websiteData }] = await Promise.all([
    supabase.rpc("operon_clients"),
    supabase.rpc("operon_zone_month_overview"),
    supabase.rpc("operon_ical_overview"),
    supabase.rpc("operon_websites"),
  ])
  if (error) notFound()
  const websites = new Map((websiteData ?? []).map((w) => [w.organization_id, w]))
  const zones = new Map(((zoneData ?? []) as unknown as ZoneOverview[]).map((z) => [z.organization_id, z]))
  const icalProblems = new Map<string, number>()
  for (const row of (icalData ?? []) as IcalStatusRow[]) {
    if (isIcalProblem(row)) icalProblems.set(row.organization_id, (icalProblems.get(row.organization_id) ?? 0) + 1)
  }

  const { estado } = await searchParams
  const filter: Filter = FILTERS.some((f) => f.key === estado) ? (estado as Filter) : "todos"

  // Un widget de otro complejo, sin completar o de demostración no manda las reservas al panel.
  const widgetBroken = (c: ClientRow) => {
    const status = websites.get(c.organization_id)?.website_status
    return status === "mismatch" || status === "unconfigured" || status === "demo"
  }
  const hasProblems = (c: ClientRow) =>
    c.email_failed_30d > 0 || c.email_stuck > 0 || (icalProblems.get(c.organization_id) ?? 0) > 0 || widgetBroken(c)
  const all = (data ?? []) as ClientRow[]
  const clients = all.filter((c) => matches(filter, c, hasProblems))
  const now = currentTime()
  const base = await siteUrl()

  const running = all.filter((c) => !c.suspended_at)
  const active = running.filter((c) => activity(c, now).days <= 30).length
  const reservationsMonth = all.reduce((sum, c) => sum + c.reservations_month, 0)
  const withProblems = all.filter(hasProblems).length
  const suspended = all.length - running.length

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl leading-tight font-semibold sm:text-[28px]">Clientes</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Cada complejo que usa Operon Reservas: quién lo maneja, cuánto lo usa, qué le falta
            configurar y si algo está fallando. Tocá un complejo para ver su ficha.
          </p>
        </div>
        <Link href="/operon/invitaciones" className={cn(buttonVariants(), "h-9 px-3.5")}>
          <UserPlus /> Invitar cliente
        </Link>
      </header>

      <section aria-label="Resumen" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Clientes"
          value={running.length}
          note={suspended > 0 ? `+${suspended} suspendido${suspended === 1 ? "" : "s"}` : undefined}
        />
        <Stat label="Activos · 30 días" value={active} of={running.length} />
        <Stat label="Reservas este mes" value={reservationsMonth} />
        <Stat
          label="Con problemas"
          value={withProblems}
          tone={withProblems > 0 ? "warning" : undefined}
          note={withProblems > 0 ? "Mails, calendarios o webs con fallas" : "Todo en orden"}
        />
      </section>

      <nav aria-label="Filtrar clientes" className="mt-6 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = all.filter((c) => matches(f.key, c, hasProblems)).length
          const current = f.key === filter
          return (
            <Link
              key={f.key}
              href={f.key === "todos" ? "/operon" : `/operon?estado=${f.key}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                current ? "border-transparent bg-foreground text-background" : "hover:bg-muted"
              )}
            >
              {f.label} <span className="font-mono text-xs tabular-nums opacity-70">{count}</span>
            </Link>
          )
        })}
      </nav>

      <section className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm">
        {all.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium">Todavía no hay clientes.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cuando alguien termine la configuración con una invitación, aparece acá.
            </p>
            <Link
              href="/operon/invitaciones"
              className={cn(buttonVariants({ variant: "outline" }), "mt-4")}
            >
              <UserPlus /> Invitar al primero
            </Link>
          </div>
        ) : clients.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Ningún cliente en este filtro.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  {["Complejo", "Dueño", "Actividad", "Unidades", "Reservas", "Configuración", "Web", "Salud", "Tu zona", "Alta"].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="label-mono px-4 py-2.5 font-normal whitespace-nowrap text-muted-foreground"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const status = activity(client, now)
                  return (
                    <tr
                      key={client.organization_id}
                      className={cn(
                        "border-b align-top transition-colors last:border-b-0 hover:bg-muted/30",
                        client.suspended_at && "bg-muted/20"
                      )}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/operon/clientes/${client.organization_id}`}
                          className="group inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          {client.name}
                          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        {client.suspended_at && (
                          <span className="label-mono ml-2 rounded-md bg-destructive/15 px-1.5 py-0.5 text-destructive">
                            Suspendido
                          </span>
                        )}
                        <a
                          href={`${base}/reservar/${client.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          /reservar/{client.slug}
                        </a>
                      </td>

                      <td className="px-4 py-3">
                        {client.owner_email ? (
                          <>
                            <p>{client.owner_name || "Sin nombre"}</p>
                            <p className="text-xs text-muted-foreground">{client.owner_email}</p>
                            {client.members > 1 && (
                              <p className="label-mono mt-1 text-muted-foreground">
                                +{client.members - 1} en el equipo
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">Sin dueño asignado</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span aria-hidden className={cn("size-2 rounded-full", status.dot)} />
                          {status.label}
                        </span>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {client.last_sign_in_at
                            ? `Último ingreso ${relative(client.last_sign_in_at, now)}`
                            : "Nunca inició sesión"}
                        </p>
                      </td>

                      <td className="px-4 py-3 font-mono tabular-nums">{client.units}</td>

                      <td className="px-4 py-3">
                        <p className="whitespace-nowrap">
                          <span className="font-mono tabular-nums">{client.reservations_month}</span>{" "}
                          <span className="text-muted-foreground">este mes</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {client.reservations_total} en total
                          {client.last_reservation_at &&
                            ` · última ${relative(client.last_reservation_at, now)}`}
                        </p>
                      </td>

                      <td className="px-4 py-3">
                        <MpBadge connected={client.mp_connected} live={client.mp_live} />
                        {!client.deposit_configured && (
                          <p className="mt-1.5 text-xs text-muted-foreground">Sin seña configurada</p>
                        )}
                        {!client.link_shared && (
                          <p className="mt-0.5 text-xs text-muted-foreground">No compartió su link</p>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <WebBadge row={websites.get(client.organization_id)} now={now} />
                      </td>

                      <td className="px-4 py-3">
                        <Health
                          failed={client.email_failed_30d}
                          stuck={client.email_stuck}
                          calendars={icalProblems.get(client.organization_id) ?? 0}
                        />
                      </td>

                      <td className="px-4 py-3">
                        <ZoneBadge summary={overviewSummary(zones.get(client.organization_id), now)} />
                      </td>

                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {shortDate(client.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function WebBadge({ row, now }: { row: { website_status: string | null; website_checked_at: string | null } | undefined; now: number }) {
  if (!row) return <span className="text-xs text-muted-foreground">Sin cargar</span>
  const info = row.website_status && row.website_status in WEBSITE_STATUS ? WEBSITE_STATUS[row.website_status as WebsiteStatus] : null
  const tones = {
    success: "bg-success/15 text-success",
    warning: "bg-warning/30 text-warning-foreground",
    danger: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
  } as const
  return (
    <div>
      <span className={cn("label-mono rounded-md px-2 py-1 whitespace-nowrap", tones[info?.tone ?? "muted"])}>
        {info?.label ?? "Sin verificar"}
      </span>
      {row.website_checked_at && <p className="mt-1 text-xs text-muted-foreground">{relative(row.website_checked_at, now)}</p>}
    </div>
  )
}

function ZoneBadge({ summary }: { summary: ReturnType<typeof overviewSummary> }) {
  return (
    <span className={cn("label-mono rounded-md px-2 py-1 whitespace-nowrap", TONE_CLASSES[summary.tone])}>
      {summary.label}
    </span>
  )
}

function Health({ failed, stuck, calendars }: { failed: number; stuck: number; calendars: number }) {
  if (failed === 0 && stuck === 0 && calendars === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        OK
      </span>
    )
  }
  return (
    <div className="space-y-0.5 text-xs whitespace-nowrap">
      {failed > 0 && (
        <p className="inline-flex items-center gap-1.5 text-destructive">
          <span aria-hidden className="size-2 rounded-full bg-destructive" />
          {failed} mail{failed === 1 ? "" : "s"} sin enviar
        </p>
      )}
      {calendars > 0 && (
        <p className="flex items-center gap-1.5 text-destructive">
          <span aria-hidden className="size-2 rounded-full bg-destructive" />
          {calendars} calendario{calendars === 1 ? "" : "s"} con fallas
        </p>
      )}
      {stuck > 0 && (
        <p className="flex items-center gap-1.5 text-warning-foreground">
          <span aria-hidden className="size-2 rounded-full bg-warning" />
          {stuck} trabado{stuck === 1 ? "" : "s"}
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  of,
  note,
  tone,
}: {
  label: string
  value: number
  of?: number
  note?: string
  tone?: "warning"
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="label-mono text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-heading text-3xl font-semibold tracking-tight tabular-nums",
          tone === "warning" && "text-destructive"
        )}
      >
        {value}
        {of !== undefined && (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">de {of}</span>
        )}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
