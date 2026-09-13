import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { UserPlus } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { formatCurrency } from "@/lib/format"
import { siteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Clientes · Operon",
  robots: { index: false, follow: false },
}

type ClientRow = {
  organization_id: string
  name: string
  slug: string
  created_at: string
  owner_email: string | null
  owner_name: string | null
  last_sign_in_at: string | null
  members: number
  units: number
  reservations_total: number
  reservations_month: number
  last_reservation_at: string | null
  paid_month: number
  currency: string
  deposit_pct: number
  mp_connected: boolean
  mp_live: boolean
  link_shared: boolean
}

const DAY = 86_400_000
const relativeTime = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" })

// Fuera del componente: la regla de pureza de React no deja leer el reloj
// directo en el render.
function currentTime() {
  return Date.now()
}

function daysSince(iso: string | null, now: number) {
  return iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : Infinity
}

function relative(iso: string, now: number) {
  const days = (new Date(iso).getTime() - now) / DAY
  if (Math.abs(days) < 1) {
    const hours = Math.round(days * 24)
    return hours === 0 ? "recién" : relativeTime.format(hours, "hour")
  }
  if (Math.abs(days) < 30) return relativeTime.format(Math.round(days), "day")
  return relativeTime.format(Math.round(days / 30), "month")
}

/**
 * `last_sign_in_at` cuenta inicios de sesión, no uso: una sesión abierta se
 * renueva sola y no lo actualiza. Por eso "activo" también mira la última
 * reserva cargada, y la etiqueta habla de ingresos, no de "uso".
 */
function activity(client: ClientRow, now: number) {
  const days = Math.min(daysSince(client.last_sign_in_at, now), daysSince(client.last_reservation_at, now))
  if (days === Infinity) return { label: "Sin actividad", dot: "bg-muted-foreground/40", days }
  if (days <= 7) return { label: "Activo", dot: "bg-success", days }
  if (days <= 30) return { label: "Poco activo", dot: "bg-warning", days }
  return { label: "Inactivo", dot: "bg-destructive", days }
}

export default async function ClientesPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("operon_clients")
  if (error) notFound()

  const clients = (data ?? []) as ClientRow[]
  const now = currentTime()
  const base = await siteUrl()

  const active = clients.filter((c) => activity(c, now).days <= 30).length
  const reservationsMonth = clients.reduce((sum, c) => sum + c.reservations_month, 0)
  const withMp = clients.filter((c) => c.mp_connected).length

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl leading-tight font-semibold sm:text-[28px]">Clientes</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Cada complejo que usa Operon Reservas: quién lo maneja, cuánto lo usa y qué le falta
            configurar.
          </p>
        </div>
        <Link href="/operon/invitaciones" className={cn(buttonVariants(), "h-9 px-3.5")}>
          <UserPlus /> Invitar cliente
        </Link>
      </header>

      <section aria-label="Resumen" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clientes" value={clients.length} />
        <Stat label="Activos · 30 días" value={active} of={clients.length} />
        <Stat label="Reservas este mes" value={reservationsMonth} />
        <Stat label="Con Mercado Pago" value={withMp} of={clients.length} />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
        {clients.length === 0 ? (
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  {["Complejo", "Dueño", "Actividad", "Unidades", "Reservas", "Cobrado este mes", "Mercado Pago", "Alta"].map(
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
                  const paid = Number(client.paid_month)
                  return (
                    <tr key={client.organization_id} className="border-b align-top last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-medium">{client.name}</p>
                        <a
                          href={`${base}/reservar/${client.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
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

                      <td className="px-4 py-3 font-mono whitespace-nowrap tabular-nums">
                        {paid > 0 ? (
                          formatCurrency(paid, client.currency)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {client.mp_connected ? (
                          <span
                            className={cn(
                              "label-mono rounded-md px-2 py-1 whitespace-nowrap",
                              client.mp_live
                                ? "bg-success/15 text-success"
                                : "bg-warning/30 text-warning-foreground"
                            )}
                          >
                            {client.mp_live ? "Conectado" : "Modo prueba"}
                          </span>
                        ) : (
                          <span className="label-mono rounded-md bg-muted px-2 py-1 whitespace-nowrap text-muted-foreground">
                            Sin conectar
                          </span>
                        )}
                        {Number(client.deposit_pct) === 0 && (
                          <p className="mt-1.5 text-xs text-muted-foreground">Sin seña configurada</p>
                        )}
                      </td>

                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {new Date(client.created_at).toLocaleDateString("es-AR", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
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

function Stat({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-3xl font-semibold tracking-tight tabular-nums">
        {value}
        {of !== undefined && (
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">de {of}</span>
        )}
      </p>
    </div>
  )
}
