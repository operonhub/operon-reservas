import Link from "next/link"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  formatCurrency,
  nightsBetween,
  todayISO,
  whatsappHref,
  initials,
} from "@/lib/format"
import { GUEST_KIND, kindFromCount, typicalPartySize } from "@/lib/guest-profile"
import { ENTER, ENTER_UP, stagger } from "@/lib/motion"
import { Mail, MessageCircle, Repeat2, Clock3 } from "lucide-react"
import type { Enums } from "@/lib/supabase/types"

type ResRow = {
  guests_count: number
  check_in: string
  check_out: string
  total_amount: number | null
  currency: string
  status: Enums<"reservation_status">
}

// Solo estas cuentan como estadía real para plata y noches.
const REAL: Enums<"reservation_status">[] = ["confirmed", "completed"]

export default async function HuespedesPage() {
  const ctx = await requireContext()
  const supabase = await createClient()
  const today = todayISO()

  const { data: guests } = await supabase
    .from("guests")
    .select(
      "id, full_name, email, phone, created_at, reservations(guests_count, check_in, check_out, total_amount, currency, status)"
    )
    .order("full_name", { ascending: true })

  const list = (guests ?? []).map((g) => {
    const res = ((g.reservations as ResRow[] | null) ?? []).filter(
      (r) => r.status !== "cancelled" && r.status !== "expired"
    )
    const real = res.filter((r) => REAL.includes(r.status))
    const party = typicalPartySize(res.map((r) => r.guests_count))
    const nights = real.reduce((s, r) => s + nightsBetween(r.check_in, r.check_out), 0)
    const spent = real.reduce((s, r) => s + Number(r.total_amount ?? 0), 0)
    const past = real.filter((r) => r.check_out <= today).sort((a, b) => (a.check_out < b.check_out ? 1 : -1))
    const upcoming = res
      .filter((r) => r.check_in >= today)
      .sort((a, b) => (a.check_in > b.check_in ? 1 : -1))

    return {
      id: g.id,
      name: g.full_name,
      email: g.email,
      phone: g.phone,
      currency: real[0]?.currency ?? "ARS",
      kind: kindFromCount(party),
      party,
      // Los tres números de la card cuentan lo MISMO (estadías confirmadas),
      // si no quedaba "1 reserva · 0 noches · $0" y parecía un error de cálculo.
      // Lo pendiente se muestra aparte, que además es lo accionable.
      count: real.length,
      pending: res.length - real.length,
      nights,
      spent,
      lastStay: past[0]?.check_out ?? null,
      nextStay: upcoming[0]?.check_in ?? null,
      recurrent: real.length > 1,
    }
  })

  return (
    <div className="p-6 space-y-6">
      <header className={ENTER}>
        <p className="label-mono text-muted-foreground">{ctx.organizationName}</p>
        <h1 className="mt-1 text-2xl font-semibold">Huéspedes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {list.length} {list.length === 1 ? "huésped" : "huéspedes"} · se identifican
          por email para no duplicar
        </p>
      </header>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Todavía no hay huéspedes. Se crean solos al cargar o recibir reservas.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((g, i) => {
            const kind = GUEST_KIND[g.kind]
            const KindIcon = kind.icon
            return (
              <Card
                key={g.id}
                className={cn(ENTER_UP, "transition-all hover:border-primary/40 hover:shadow-md")}
                style={stagger(i, 60)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-sm font-semibold">
                      {initials(g.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/huespedes/${g.id}`}
                        className="block truncate font-heading font-medium tracking-tight transition-colors hover:text-primary"
                      >
                        {g.name}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge
                          className={cn("label-mono border-transparent gap-1", kind.className)}
                        >
                          <KindIcon className="size-3" />
                          {kind.label}
                          {g.party > 1 && ` · ${g.party}`}
                        </Badge>
                        {g.recurrent && (
                          <Badge className="label-mono gap-1 border-transparent bg-primary/15 text-foreground">
                            <Repeat2 className="size-3" />
                            Recurrente
                          </Badge>
                        )}
                        {g.pending > 0 && (
                          <Badge className="label-mono gap-1 border-transparent bg-warning/30 text-foreground">
                            <Clock3 className="size-3" />
                            {g.pending} sin confirmar
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">
                    <Stat label="Estadías" value={String(g.count)} />
                    <Stat label="Noches" value={String(g.nights)} />
                    <Stat
                      label="Facturado"
                      value={formatCurrency(g.spent, g.currency)}
                      emphasis
                    />
                  </dl>

                  <p className="mt-3 text-xs text-muted-foreground">
                    {g.nextStay ? (
                      <>
                        Próxima llegada{" "}
                        <span className="font-mono text-foreground tabular-nums">
                          {g.nextStay}
                        </span>
                      </>
                    ) : g.lastStay ? (
                      <>
                        Última estadía{" "}
                        <span className="font-mono tabular-nums">{g.lastStay}</span>
                      </>
                    ) : (
                      "Sin estadías registradas"
                    )}
                  </p>

                  {(g.phone || g.email) && (
                    <div className="mt-3 flex gap-2">
                      {g.phone && (
                        <a
                          href={whatsappHref(g.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="label-mono inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2 py-1 text-foreground transition-colors hover:bg-success/25"
                        >
                          <MessageCircle className="size-3" /> WhatsApp
                        </a>
                      )}
                      {g.email && (
                        <a
                          href={`mailto:${g.email}`}
                          className="label-mono inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Mail className="size-3 shrink-0" />
                          <span className="truncate">{g.email}</span>
                        </a>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div>
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 font-mono tabular-nums",
          emphasis ? "text-sm font-medium" : "text-sm"
        )}
      >
        {value}
      </dd>
    </div>
  )
}
