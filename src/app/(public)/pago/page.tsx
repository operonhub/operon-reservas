"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2, CheckCircle2, XCircle, Clock, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/format"
import { ENTER, ENTER_UP, ENTER_POP, stagger } from "@/lib/motion"
import { OperonFooter } from "@/components/public/operon-footer"
import {
  getReservationStatus,
  type PublicReservationStatus,
} from "./actions"

// Cuánto insistimos consultando el backend antes de dejar de auto-refrescar.
const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 24 // ~60s

type Phase = "loading" | "confirmed" | "waiting" | "gone" | "not_found"

function phaseOf(status: string | undefined): Phase {
  if (status === "confirmed" || status === "completed") return "confirmed"
  if (status === "expired" || status === "cancelled") return "gone"
  return "waiting" // pending / pending_payment / inquiry
}

function whatsappHref(rawPhone: string): string {
  const digits = rawPhone.replace(/[^\d]/g, "")
  return `https://wa.me/${digits}`
}

export default function PagoPage() {
  return (
    <React.Suspense
      fallback={
        <Shell>
          <Loader2 className="mx-auto size-12 animate-spin text-muted-foreground" />
        </Shell>
      }
    >
      <PagoContent />
    </React.Suspense>
  )
}

function PagoContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get("code")
  const orgSlug = searchParams.get("org")

  const [reservation, setReservation] = React.useState<PublicReservationStatus | null>(
    null
  )
  const [notFound, setNotFound] = React.useState(false)
  const [timedOut, setTimedOut] = React.useState(false)
  const [retrying, setRetrying] = React.useState(false)

  // Un solo intervalo estable (no depende de estado que cambia en cada
  // tick, para no reiniciarse solo). Se autodetiene al llegar a un estado
  // terminal o al agotar los intentos — `attempts` vive fuera de React
  // porque solo lo necesita este efecto, no la UI.
  React.useEffect(() => {
    if (!code || !orgSlug) return
    let cancelled = false
    let attempts = 0

    function stop() {
      cancelled = true
      clearInterval(id)
    }

    async function tick() {
      const res = await getReservationStatus(orgSlug!, code!)
      if (cancelled) return
      attempts += 1

      if (!res.ok) {
        setNotFound(true)
        stop()
        return
      }
      setReservation(res.reservation)

      if (phaseOf(res.reservation.status) !== "waiting") {
        stop()
        return
      }
      if (attempts >= MAX_POLLS) {
        setTimedOut(true)
        stop()
      }
    }

    tick()
    const id = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [code, orgSlug])

  async function onRetryPayment() {
    if (!code || !orgSlug) return
    setRetrying(true)
    try {
      const res = await fetch("/api/mp/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, orgSlug }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        init_point?: string
      }
      if (!res.ok || !data.init_point) {
        setRetrying(false)
        return
      }
      window.location.href = data.init_point
    } catch {
      setRetrying(false)
    }
  }

  if (!code || !orgSlug || notFound) {
    return (
      <Shell>
        <XCircle className="mx-auto size-12 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-semibold">No encontramos tu reserva</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Revisá el link o contactá al alojamiento con tu código de reserva.
        </p>
        <BackLink />
      </Shell>
    )
  }

  const phase: Phase = reservation ? phaseOf(reservation.status) : "loading"

  if (phase === "loading" || (phase === "waiting" && !timedOut)) {
    return (
      <Shell>
        <Loader2 className="mx-auto size-12 animate-spin text-primary" />
        <h1 className={`${ENTER} mt-4 text-2xl font-semibold`}>
          Estamos confirmando tu pago…
        </h1>
        <p className={`${ENTER} mt-2 text-sm text-muted-foreground`} style={stagger(1)}>
          En cuanto Mercado Pago nos avise, tu reserva se confirma sola. No
          hace falta que recargues la página.
        </p>
        {code && <CodeChip code={code} />}
      </Shell>
    )
  }

  if (phase === "confirmed" && reservation) {
    const r = reservation
    const balance =
      r.total_amount != null ? Number(r.total_amount) - Number(r.deposit_paid) : null
    const rows = [
      { label: "Alojamiento", value: r.property_name },
      { label: "Unidad", value: r.unit_name },
      { label: "Check-in", value: r.check_in, mono: true },
      { label: "Check-out", value: r.check_out, mono: true },
      { label: "Huéspedes", value: String(r.guests_count), mono: true },
      { label: "Total", value: formatCurrency(r.total_amount, r.currency), mono: true },
      {
        label: "Seña abonada",
        value: formatCurrency(r.deposit_paid, r.currency),
        mono: true,
      },
      {
        label: "Saldo pendiente",
        value: formatCurrency(balance, r.currency),
        mono: true,
      },
    ]
    return (
      <Shell>
        {/* Peak-end: es el momento que el huésped se lleva de todo el flujo. */}
        <div className={ENTER_POP}>
          <CheckCircle2 className="mx-auto size-14 text-success" />
        </div>
        <h1 className={`${ENTER_UP} mt-4 text-2xl font-semibold`} style={stagger(1)}>
          ¡Tu reserva está confirmada!
        </h1>
        <div
          className={`${ENTER_UP} mt-6 w-full rounded-xl border bg-card p-5 text-left text-sm`}
          style={stagger(2)}
        >
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`${ENTER} flex items-center justify-between border-b py-2 last:border-0`}
              style={stagger(i + 3, 45)}
            >
              <span className="label-mono text-muted-foreground">{row.label}</span>
              <span className={row.mono ? "font-mono font-medium tabular-nums" : "font-medium"}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <CodeChip code={r.code} />
        {r.property_whatsapp && (
          <a
            href={whatsappHref(r.property_whatsapp)}
            target="_blank"
            rel="noreferrer"
            className={`${ENTER_UP} mt-6 inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-success-foreground transition-opacity hover:opacity-90`}
            style={stagger(11)}
          >
            <MessageCircle className="size-4" /> Hablar con el alojamiento por WhatsApp
          </a>
        )}
        <BackLink />
        <OperonFooter />
      </Shell>
    )
  }

  if (phase === "gone" && reservation) {
    return (
      <Shell>
        <div className={ENTER}>
          <XCircle className="mx-auto size-12 text-destructive" />
        </div>
        <h1 className={`${ENTER_UP} mt-4 text-2xl font-semibold`} style={stagger(1)}>
          {reservation.status === "expired"
            ? "Se venció el tiempo para pagar"
            : "La reserva fue cancelada"}
        </h1>
        <p
          className={`${ENTER_UP} mt-2 text-sm text-muted-foreground`}
          style={stagger(2)}
        >
          Las fechas ya se liberaron. Si todavía te interesa, hacé una nueva
          reserva desde la web del alojamiento.
        </p>
        <CodeChip code={reservation.code} />
        <BackLink />
        <OperonFooter />
      </Shell>
    )
  }

  // pending_payment tras agotar el polling: seguimos esperando, ofrecemos
  // reintentar el pago sin perder la reserva (mientras el hold siga vigente).
  return (
    <Shell>
      <div className={ENTER}>
        <Clock className="mx-auto size-12 text-warning" />
      </div>
      <h1 className={`${ENTER_UP} mt-4 text-2xl font-semibold`} style={stagger(1)}>
        Tu pago todavía está en proceso
      </h1>
      <p className={`${ENTER_UP} mt-2 text-sm text-muted-foreground`} style={stagger(2)}>
        Puede tardar unos minutos en confirmarse. Si el pago no se completó,
        podés intentarlo de nuevo.
      </p>
      {reservation && <CodeChip code={reservation.code} />}
      <Button
        onClick={onRetryPayment}
        disabled={retrying}
        size="lg"
        className={`${ENTER_UP} mt-6`}
        style={stagger(3)}
      >
        {retrying ? "Redirigiendo a Mercado Pago…" : "Intentar pagar de nuevo"}
      </Button>
      <BackLink />
      <OperonFooter />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      {children}
    </main>
  )
}

function CodeChip({ code }: { code: string }) {
  return (
    <p
      className={`${ENTER_UP} mt-6 rounded-lg bg-muted px-4 py-2 font-mono text-lg font-semibold tracking-wide`}
      style={stagger(2)}
    >
      {code}
    </p>
  )
}

function BackLink() {
  return (
    <Link
      href="/"
      className="mt-8 text-sm text-muted-foreground underline underline-offset-4"
    >
      Volver
    </Link>
  )
}
