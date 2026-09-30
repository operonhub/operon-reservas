import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CircleAlert, CircleCheck, CircleDashed, ExternalLink } from "lucide-react"
import { dateTime, relative, shortDate } from "@/lib/operon/format"
import {
  ACTION_LABELS,
  RESERVATION_STATUS_LABELS,
  ROLE_LABELS,
  type AuditEntry,
  type ClientDetail,
} from "@/lib/operon/types"
import { siteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { MpBadge } from "../../badges"
import { MemberActions } from "./member-actions"
import { OrgStatusAction } from "./org-actions"

export const metadata: Metadata = {
  title: "Ficha de cliente · Operon",
  robots: { index: false, follow: false },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function currentTime() {
  return Date.now()
}

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const supabase = await createClient()
  const [{ data, error }, { data: logData }] = await Promise.all([
    supabase.rpc("operon_client_detail", { p_org: id }),
    supabase.rpc("operon_audit_log", { p_org: id, p_limit: 20 }),
  ])
  if (error || !data) notFound()

  const d = data as unknown as ClientDetail
  const log = (logData ?? []) as AuditEntry[]
  const now = currentTime()
  const publicUrl = `${await siteUrl()}/reservar/${d.org.slug}`
  const owners = d.members.filter((m) => m.role === "owner").length
  const suspended = Boolean(d.org.suspended_at)

  const units = d.units.filter((u) => u.is_active)
  const setup = [
    { label: "Seña configurada", done: d.properties.some((p) => p.deposit_configured) },
    { label: "Mercado Pago conectado", done: d.mercadopago.connected },
    { label: "Compartió su link de reservas", done: Boolean(d.org.link_shared_at) },
    { label: "Fotos en todas las unidades", done: units.length > 0 && units.every((u) => u.has_photo) },
    { label: "Datos de contacto cargados", done: d.properties.some((p) => p.has_contact) },
    {
      label: "Calendario de Airbnb o Booking conectado",
      done: units.some((u) => u.airbnb_configured || u.booking_configured),
      optional: true,
    },
  ]

  return (
    <>
      <Link
        href="/operon"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Clientes
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl leading-tight font-semibold sm:text-[28px]">{d.org.name}</h1>
            {suspended && (
              <span className="label-mono rounded-md bg-destructive/15 px-2 py-1 text-destructive">
                Suspendido
              </span>
            )}
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs hover:text-foreground hover:underline"
            >
              /reservar/{d.org.slug} <ExternalLink className="size-3" />
            </a>
            <span>Alta {shortDate(d.org.created_at)}</span>
          </p>
        </div>
        <OrgStatusAction orgId={d.org.id} orgName={d.org.name} suspended={suspended} />
      </header>

      {suspended && (
        <div role="status" className="mt-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            Suspendido {relative(d.org.suspended_at!, now)}
            {d.org.suspension?.actor_email && ` por ${d.org.suspension.actor_email}`}
          </p>
          {d.org.suspension?.reason && <p className="mt-1">Motivo: {d.org.suspension.reason}</p>}
          <p className="mt-1 text-muted-foreground">
            El equipo no entra al panel y la página de reservas no acepta reservas nuevas. Los pagos en
            curso y el calendario que leen Airbnb y Booking siguen funcionando.
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Section title="Equipo" className="lg:col-span-2">
          <ul className="divide-y">
            {d.members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium">
                    {m.full_name || "Sin nombre"}
                    <span className="label-mono ml-2 text-muted-foreground">{ROLE_LABELS[m.role]}</span>
                    {m.is_platform_admin && (
                      <span className="label-mono ml-2 text-primary">Admin Operon</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.last_sign_in_at ? `Último ingreso ${relative(m.last_sign_in_at, now)}` : "Nunca inició sesión"}
                  </p>
                </div>
                <MemberActions
                  orgId={d.org.id}
                  member={m}
                  isLastOwner={m.role === "owner" && owners <= 1}
                  isPlatformAdmin={m.is_platform_admin}
                />
              </li>
            ))}
            {d.members.length === 0 && <li className="text-sm text-muted-foreground">Sin miembros.</li>}
          </ul>
        </Section>

        <Section title="Configuración">
          <ul className="space-y-2 text-sm">
            {setup.map((item) => (
              <li key={item.label} className="flex items-start gap-2">
                {item.done ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span className={cn(!item.done && "text-muted-foreground")}>
                  {item.label}
                  {item.optional && !item.done && <span className="text-xs"> (opcional)</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t pt-3">
            <MpBadge connected={d.mercadopago.connected} live={d.mercadopago.live} />
          </div>
        </Section>

        <Section title="Uso" className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            <Figure label="Este mes" value={d.reservations.month} />
            <Figure label="En total" value={d.reservations.total} />
            <Figure
              label="Última reserva"
              text={d.reservations.last_at ? relative(d.reservations.last_at, now) : "Nunca"}
            />
          </div>
          {Object.keys(d.reservations.by_status).length > 0 && (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(d.reservations.by_status).map(([status, n]) => (
                <span key={status} className="label-mono rounded-md bg-muted px-2 py-1 text-muted-foreground">
                  {RESERVATION_STATUS_LABELS[status] ?? status} · {n}
                </span>
              ))}
            </p>
          )}
          {d.reservations.recent.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left">
                  <tr>
                    {["Código", "Huésped", "Unidad", "Estadía", "Estado"].map((h) => (
                      <th key={h} className="label-mono pb-2 font-normal text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.reservations.recent.map((r) => (
                    <tr key={r.code} className="border-t">
                      <td className="py-2 font-mono text-xs">{r.code}</td>
                      <td className="py-2">{r.guest_name ?? "—"}</td>
                      <td className="py-2 text-muted-foreground">{r.unit_name ?? "—"}</td>
                      <td className="py-2 font-mono text-xs tabular-nums whitespace-nowrap">
                        {r.check_in} → {r.check_out}
                      </td>
                      <td className="py-2 text-muted-foreground">{RESERVATION_STATUS_LABELS[r.status] ?? r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Salud">
          <EmailHealth health={d.email_health} now={now} />
        </Section>

        <Section title="Alojamiento" className="lg:col-span-2">
          {d.properties.map((p) => (
            <p key={p.id} className="text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground">
                {" · "}
                {[p.city, p.country].filter(Boolean).join(", ") || "Sin ubicación"}
                {!p.is_active && " · inactiva"}
              </span>
            </p>
          ))}
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {d.units.map((u) => (
              <li key={u.id} className={cn("rounded-xl border p-3 text-sm", !u.is_active && "opacity-60")}>
                <p className="font-medium">
                  {u.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    hasta {u.capacity} {u.capacity === 1 ? "persona" : "personas"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    !u.is_active && "Inactiva",
                    u.has_photo ? "Con foto" : "Sin foto",
                    u.airbnb_configured && "Airbnb",
                    u.booking_configured && "Booking",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Registro">
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay acciones sobre este cliente.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {log.map((e) => (
                <li key={e.id}>
                  <p>
                    {ACTION_LABELS[e.action] ?? e.action}
                    {e.target_email && <span className="text-muted-foreground"> · {e.target_email}</span>}
                  </p>
                  {e.reason && <p className="text-muted-foreground">“{e.reason}”</p>}
                  <p className="font-mono text-xs text-muted-foreground">
                    {dateTime(e.created_at)} · {e.actor_email ?? "—"}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <Link href={`/operon/actividad?org=${d.org.id}`} className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
            Ver todo el registro
          </Link>
        </Section>
      </div>
    </>
  )
}

function Section({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>
      <h2 className="label-mono mb-3 text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Figure({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div>
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{text ?? value}</p>
    </div>
  )
}

function EmailHealth({ health, now }: { health: ClientDetail["email_health"]; now: number }) {
  const problems = health.failed_final + health.stuck
  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-center gap-2">
        {problems === 0 ? (
          <CircleCheck className="size-4 text-success" />
        ) : (
          <CircleAlert className="size-4 text-destructive" />
        )}
        {problems === 0 ? "Los mails de reservas salen bien." : "Hay mails de reservas que no salen."}
      </p>
      <ul className="space-y-1 text-muted-foreground">
        <li>{health.sent_30d} enviados en los últimos 30 días</li>
        {health.failed_final > 0 && (
          <li className="text-destructive">{health.failed_final} no se pudieron enviar (se agotaron los reintentos)</li>
        )}
        {health.retrying > 0 && <li>{health.retrying} reintentándose</li>}
        {health.stuck > 0 && <li className="text-destructive">{health.stuck} trabados hace más de una hora</li>}
      </ul>
      {health.last_error && (
        <div className="rounded-lg bg-muted p-2">
          <p className="label-mono text-muted-foreground">
            Último error{health.last_failed_at && ` · ${relative(health.last_failed_at, now)}`}
          </p>
          <p className="mt-1 font-mono text-xs break-words">{health.last_error}</p>
        </div>
      )}
    </div>
  )
}
