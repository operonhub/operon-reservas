import Link from "next/link"
import { notFound } from "next/navigation"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge, SourceBadge } from "@/components/reservations/reservation-badges"
import { StatusControl } from "@/components/reservations/status-control"
import { formatCurrency, nightsBetween } from "@/lib/format"
import { ArrowLeft } from "lucide-react"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  )
}

export default async function ReservaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireContext()
  const supabase = await createClient()

  const { data: r } = await supabase
    .from("reservations")
    .select(
      "id, code, check_in, check_out, guests_count, status, source, total_amount, deposit_amount, currency, notes, created_at, guests(full_name, email, phone), units(name, capacity), payments(amount, status, kind, paid_at)"
    )
    .eq("id", id)
    .maybeSingle()

  if (!r) notFound()

  const guest = r.guests as { full_name: string; email: string | null; phone: string | null } | null
  const unit = r.units as { name: string; capacity: number } | null
  const payments = (r.payments as { amount: number; status: string; kind: string; paid_at: string | null }[]) ?? []
  const paid = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount), 0)
  const balance = r.total_amount != null ? Number(r.total_amount) - paid : null

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <Link
          href="/reservas"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Volver a Reservas
        </Link>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{r.code}</h1>
          <StatusBadge status={r.status} />
          <SourceBadge source={r.source} />
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Estadía</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Unidad">{unit?.name ?? "—"}</Field>
              <Field label="Huéspedes">
                {r.guests_count}
                {unit ? ` / ${unit.capacity}` : ""}
              </Field>
              <Field label="Ingreso">{r.check_in}</Field>
              <Field label="Salida">{r.check_out}</Field>
              <Field label="Noches">{nightsBetween(r.check_in, r.check_out)}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Huésped</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Field label="Nombre">{guest?.full_name ?? "—"}</Field>
              <Field label="Email">{guest?.email ?? "—"}</Field>
              <Field label="Teléfono">{guest?.phone ?? "—"}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Importes</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Total">{formatCurrency(r.total_amount, r.currency)}</Field>
              <Field label="Seña requerida">
                {formatCurrency(r.deposit_amount, r.currency)}
              </Field>
              <Field label="Pagado">{formatCurrency(paid, r.currency)}</Field>
              <Field label="Saldo">{formatCurrency(balance, r.currency)}</Field>
            </dl>
            {payments.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Sin pagos registrados. (La conexión con Mercado Pago llega en una etapa futura.)
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Estado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusControl id={r.id} status={r.status} />
          </CardContent>
        </Card>
      </div>

      {r.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Observaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
