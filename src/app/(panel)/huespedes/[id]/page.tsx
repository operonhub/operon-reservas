import Link from "next/link"
import { notFound } from "next/navigation"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/reservations/reservation-badges"
import { ArrowLeft } from "lucide-react"

export default async function HuespedDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireContext()
  const supabase = await createClient()

  const { data: g } = await supabase
    .from("guests")
    .select(
      "id, full_name, email, phone, notes, reservations(id, code, check_in, check_out, status, units(name))"
    )
    .eq("id", id)
    .maybeSingle()

  if (!g) notFound()

  const reservations =
    (g.reservations as {
      id: string
      code: string
      check_in: string
      check_out: string
      status: "inquiry" | "pending" | "pending_payment" | "confirmed" | "completed" | "cancelled"
      units: { name: string } | { name: string }[] | null
    }[]) ?? []

  reservations.sort((a, b) => (a.check_in < b.check_in ? 1 : -1))

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <Link
          href="/huespedes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Volver a Huéspedes
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{g.full_name}</h1>
        <p className="text-sm text-muted-foreground">
          {[g.email, g.phone].filter(Boolean).join(" · ") || "Sin datos de contacto"}
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Historial de reservas ({reservations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reservations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin reservas.</p>
          ) : (
            <ul className="divide-y">
              {reservations.map((r) => {
                const unit = r.units as { name: string } | { name: string }[] | null
                const unitName = Array.isArray(unit) ? unit[0]?.name : unit?.name
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/reservas/${r.id}`} className="font-medium hover:underline">
                      {r.code}
                    </Link>
                    <span className="text-muted-foreground">
                      {unitName} · {r.check_in} → {r.check_out}
                    </span>
                    <StatusBadge status={r.status} />
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {g.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notas internas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{g.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
