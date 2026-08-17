"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import { formatCurrency } from "@/lib/format"
import { Button } from "@/components/ui/button"

type ReservationStatus = {
  code: string
  status: string
  payment_status: string | null
  property_name: string | null
  unit_name: string | null
  check_in: string
  check_out: string
  guests_count: number
  total_amount: number | null
  deposit_amount: number | null
  paid_amount: number | null
  remaining_amount: number | null
  currency: string
  hold_expires_at: string | null
}

const POLL_MS = 3000
const MAX_POLLS = 60 // ~3 minutos

/**
 * Pantalla de resultado del pago. NUNCA confía en el query param que manda
 * Mercado Pago al redirigir (es del navegador, no verificado) — consulta el
 * estado real de la reserva al backend (post-webhook) y va a buscarlo de
 * nuevo mientras siga sin resolverse, hasta que el webhook la confirme.
 */
export function PagoStatus({ code, orgSlug }: { code: string; orgSlug: string }) {
  const [data, setData] = React.useState<ReservationStatus | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [polls, setPolls] = React.useState(0)
  const [retrying, setRetrying] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    async function tick() {
      const { data: res, error } = await supabase.rpc("public_reservation_status", {
        p_org_slug: orgSlug,
        p_code: code,
      })
      if (cancelled) return
      if (error || !res) {
        setNotFound(true)
        return
      }
      setData(res as ReservationStatus)
    }

    tick()
    const iv = setInterval(() => {
      setPolls((p) => p + 1)
      tick()
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [code, orgSlug])

  async function retryPayment() {
    setRetrying(true)
    try {
      const res = await fetch("/api/mp/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, orgSlug }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        init_point?: string
      }
      if (res.ok && json.init_point) {
        window.location.href = json.init_point
        return
      }
    } catch {
      // sigue abajo mostrando el error genérico
    }
    setRetrying(false)
  }

  if (notFound) {
    return (
      <Shell emoji="🔎" title="No encontramos tu reserva">
        <p className="mt-2 text-sm text-muted-foreground">
          El código {code} no corresponde a una reserva válida. Si venís de pagar,
          escribile al alojamiento con este código para que lo revisen.
        </p>
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell emoji="⏳" title="Confirmando tu pago…">
        <p className="mt-2 text-sm text-muted-foreground">Ya volvemos con el resultado.</p>
      </Shell>
    )
  }

  const stillPolling = polls < MAX_POLLS

  // ---------- Confirmada (fuente: backend, ya verificado con Mercado Pago) ----------
  if (data.status === "confirmed" || data.status === "completed") {
    return (
      <Shell emoji="✅" title="¡Tu reserva está confirmada!">
        <p className="mt-2 text-sm text-muted-foreground">
          La seña se acreditó y quedó todo listo.
        </p>
        <ReservationCard data={data} />
      </Shell>
    )
  }

  // ---------- Expiró el hold (nadie pagó a tiempo) ----------
  if (data.status === "expired") {
    return (
      <Shell emoji="⌛" title="La reserva expiró">
        <p className="mt-2 text-sm text-muted-foreground">
          No llegamos a recibir el pago a tiempo y liberamos las fechas. Si todavía te
          interesa, volvé a la web y reservá de nuevo.
        </p>
      </Shell>
    )
  }

  // ---------- Cancelada ----------
  if (data.status === "cancelled") {
    return (
      <Shell emoji="❌" title="Reserva cancelada">
        <p className="mt-2 text-sm text-muted-foreground">
          Esta reserva fue cancelada. Si es un error, escribile al alojamiento con el
          código {code}.
        </p>
      </Shell>
    )
  }

  // ---------- Pago rechazado/fallido pero el hold sigue vigente: reintentar ----------
  if (data.payment_status === "failed") {
    return (
      <Shell emoji="⚠️" title="El pago no se completó">
        <p className="mt-2 text-sm text-muted-foreground">
          Podés intentarlo de nuevo — tu reserva sigue reservada por unos minutos más.
        </p>
        <Button onClick={retryPayment} disabled={retrying} className="mt-6 w-full">
          {retrying ? "Redirigiendo a Mercado Pago…" : "Intentar pagar nuevamente"}
        </Button>
        <ReservationCard data={data} compact />
      </Shell>
    )
  }

  // ---------- Todavía procesando: seguimos consultando ----------
  return (
    <Shell emoji="⏳" title="Estamos confirmando tu pago…">
      <p className="mt-2 text-sm text-muted-foreground">
        {stillPolling
          ? "Mercado Pago está procesando el pago. En cuanto se acredite, tu reserva se confirma sola — no hace falta que hagas nada."
          : "Está tardando más de lo normal. Podés cerrar esta pantalla: te avisamos por email apenas se confirme."}
      </p>
      <ReservationCard data={data} compact />
    </Shell>
  )
}

function Shell({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">{emoji}</div>
      <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  )
}

function ReservationCard({ data, compact }: { data: ReservationStatus; compact?: boolean }) {
  return (
    <div className="mt-6 w-full rounded-xl border bg-card p-4 text-left text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-base font-semibold">{data.code}</span>
        {data.unit_name && <span className="text-muted-foreground">{data.unit_name}</span>}
      </div>
      <p className="mt-1 text-muted-foreground">
        {data.check_in} → {data.check_out} · {data.guests_count} huésped
        {data.guests_count > 1 ? "es" : ""}
      </p>
      {!compact && (
        <dl className="mt-3 space-y-1 border-t pt-3">
          {data.total_amount != null && (
            <Row label="Total" value={formatCurrency(data.total_amount, data.currency)} />
          )}
          {data.deposit_amount != null && (
            <Row
              label="Seña abonada"
              value={formatCurrency(data.paid_amount ?? data.deposit_amount, data.currency)}
            />
          )}
          {data.remaining_amount != null && (
            <Row
              label="Saldo pendiente"
              value={formatCurrency(data.remaining_amount, data.currency)}
            />
          )}
        </dl>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
