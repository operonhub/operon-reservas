import Link from "next/link"
import { notFound } from "next/navigation"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { StatusBadge, SourceBadge } from "@/components/reservations/reservation-badges"
import { StatusControl } from "@/components/reservations/status-control"
import { PrintButton } from "@/components/reservations/print-button"
import { GuestNameTrigger } from "@/components/reservations/guest-name-trigger"
import { OperonMarkTinta } from "@/components/brand/operon-mark"
import { formatCurrency, nightsBetween, whatsappHref } from "@/lib/format"
import { PAYMENT_STATUS_LABELS, PAYMENT_KIND_LABELS } from "@/lib/constants"
import { ArrowLeft, MessageCircle, Mail, CircleCheck, Clock3 } from "lucide-react"
import type { Enums } from "@/lib/supabase/types"

type Payment = {
  amount: number
  status: Enums<"payment_status">
  kind: Enums<"payment_kind">
  method: string | null
  paid_at: string | null
  created_at: string
}

/** dd/mm/aaaa — formato de comprobante, no ISO. */
function docDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function longDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export default async function ReservaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireContext()
  const supabase = await createClient()

  const [{ data: r }, { data: property }] = await Promise.all([
    supabase
      .from("reservations")
      .select(
        "id, code, check_in, check_out, guests_count, status, source, total_amount, deposit_amount, currency, notes, created_at, guests(id, full_name, email, phone), units(name, capacity), payments(amount, status, kind, method, paid_at, created_at)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("name, phone, whatsapp, email, address, city, checkin_time, checkout_time")
      .limit(1)
      .maybeSingle(),
  ])

  if (!r) notFound()

  const guest = r.guests as
    | { id: string; full_name: string; email: string | null; phone: string | null }
    | null
  const unit = r.units as { name: string; capacity: number } | null
  const payments = ((r.payments as Payment[] | null) ?? []).sort((a, b) =>
    (a.paid_at ?? a.created_at) > (b.paid_at ?? b.created_at) ? 1 : -1
  )
  const paid = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount), 0)
  const total = Number(r.total_amount ?? 0)
  const balance = Math.max(0, total - paid)
  const settled = total > 0 && balance === 0
  const nights = nightsBetween(r.check_in, r.check_out)

  return (
    <div className="p-6">
      {/* Barra de acciones — no sale en el papel */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/reservas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Volver a Reservas
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status} />
          <SourceBadge source={r.source} />
          <PrintButton />
        </div>
      </div>

      {/* ============ Comprobante ============ */}
      <article className="mx-auto max-w-3xl rounded-2xl border bg-card p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
        {/* Membrete */}
        <header className="print-block flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {property?.name ?? ctx.organizationName}
            </h1>
            <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              {(property?.address || property?.city) && (
                <p>{[property?.address, property?.city].filter(Boolean).join(" · ")}</p>
              )}
              {(property?.phone || property?.email) && (
                <p>{[property?.phone, property?.email].filter(Boolean).join(" · ")}</p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="label-mono text-muted-foreground">Comprobante de reserva</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-wide">
              {r.code}
            </p>
            <p className="label-mono mt-1 text-muted-foreground">
              Emitido {docDate(new Date().toISOString())}
            </p>
          </div>
        </header>

        {/* Huésped + estadía */}
        <section className="print-block grid gap-8 border-b py-6 sm:grid-cols-2">
          <div>
            <h2 className="label-mono mb-3 text-muted-foreground">Huésped</h2>
            <p className="font-heading text-lg font-semibold tracking-tight">
              <GuestNameTrigger guestId={guest?.id ?? null}>
                {guest?.full_name ?? "—"}
              </GuestNameTrigger>
            </p>
            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
              {guest?.email && <p>{guest.email}</p>}
              {guest?.phone && <p>{guest.phone}</p>}
            </div>
            {/* Contacto rápido: útil en pantalla, ruido en papel */}
            <div className="mt-3 flex flex-wrap gap-2 print:hidden">
              {guest?.phone && (
                <a
                  href={whatsappHref(guest.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="label-mono inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1.5 transition-colors hover:bg-success/25"
                >
                  <MessageCircle className="size-3" /> WhatsApp
                </a>
              )}
              {guest?.email && (
                <a
                  href={`mailto:${guest.email}`}
                  className="label-mono inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Mail className="size-3" /> Escribir
                </a>
              )}
            </div>
          </div>

          <div>
            <h2 className="label-mono mb-3 text-muted-foreground">Estadía</h2>
            <p className="font-heading text-lg font-semibold tracking-tight">
              {unit?.name ?? "—"}
            </p>
            <dl className="mt-2 space-y-1.5 text-sm">
              <Row label="Ingreso">
                {longDate(r.check_in)}
                {property?.checkin_time && (
                  <span className="text-muted-foreground">
                    {" "}· desde {property.checkin_time.slice(0, 5)}
                  </span>
                )}
              </Row>
              <Row label="Salida">
                {longDate(r.check_out)}
                {property?.checkout_time && (
                  <span className="text-muted-foreground">
                    {" "}· hasta {property.checkout_time.slice(0, 5)}
                  </span>
                )}
              </Row>
              <Row label="Noches">{nights}</Row>
              <Row label="Huéspedes">
                {r.guests_count}
                {unit ? ` de ${unit.capacity}` : ""}
              </Row>
            </dl>
          </div>
        </section>

        {/* Importes y pagos */}
        <section className="print-block py-6">
          <h2 className="label-mono mb-4 text-muted-foreground">Detalle de la reserva</h2>

          <dl className="space-y-2 text-sm">
            <Money label="Total de la estadía" value={formatCurrency(r.total_amount, r.currency)} />
            <Money
              label="Seña requerida"
              value={formatCurrency(r.deposit_amount, r.currency)}
              muted
            />
          </dl>

          <div className="mt-5">
            <h3 className="label-mono mb-2 text-muted-foreground">Pagos registrados</h3>
            {payments.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
                Sin pagos registrados.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {payments.map((p, i) => (
                  <li
                    key={i}
                    className="print-block flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {p.status === "paid" ? (
                        <CircleCheck className="size-4 shrink-0 text-success" />
                      ) : (
                        <Clock3 className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {PAYMENT_KIND_LABELS[p.kind]}
                          {p.method && (
                            <span className="font-normal text-muted-foreground">
                              {" "}· {p.method}
                            </span>
                          )}
                        </span>
                        <span className="label-mono text-muted-foreground">
                          {p.paid_at ? docDate(p.paid_at) : PAYMENT_STATUS_LABELS[p.status]}
                        </span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "font-mono font-medium tabular-nums",
                        p.status !== "paid" && "text-muted-foreground line-through"
                      )}
                    >
                      {formatCurrency(p.amount, r.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5 space-y-2 border-t pt-4 text-sm">
            <Money label="Cobrado" value={formatCurrency(paid, r.currency)} />
            <div
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2.5",
                settled ? "bg-success/10" : "bg-warning/20"
              )}
            >
              <span className="font-semibold">
                {settled ? "Totalmente abonado" : "Saldo a abonar"}
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {formatCurrency(settled ? total : balance, r.currency)}
              </span>
            </div>
          </div>
        </section>

        {r.notes && (
          <section className="print-block border-t py-6">
            <h2 className="label-mono mb-2 text-muted-foreground">Observaciones</h2>
            <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
          </section>
        )}

        {/* Pie: sólo en papel */}
        <footer className="hidden items-center justify-between border-t pt-4 print:flex">
          <span className="label-mono text-muted-foreground">
            Reserva {r.code} · generada el {docDate(new Date().toISOString())}
          </span>
          <span className="label-mono inline-flex items-center gap-1.5 text-muted-foreground">
            <OperonMarkTinta className="h-3.5 w-2.5" /> Operon Reservas
          </span>
        </footer>
      </article>

      {/* Gestión — fuera del comprobante */}
      <div className="mx-auto mt-5 max-w-3xl rounded-2xl border bg-card p-5 print:hidden">
        <h2 className="label-mono mb-3 text-muted-foreground">Cambiar estado</h2>
        <StatusControl id={r.id} status={r.status} />
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

function Money({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? "text-muted-foreground" : ""}>{label}</dt>
      <dd className={cn("font-mono tabular-nums", muted && "text-muted-foreground")}>
        {value}
      </dd>
    </div>
  )
}
