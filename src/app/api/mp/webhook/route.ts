import { NextResponse } from "next/server"
import type { Database } from "@/lib/supabase/types"
import { createAdminClient } from "@/lib/supabase/admin"
import { getValidCredential } from "@/lib/mp-credential"
import { getPayment } from "@/lib/mercadopago"

export const runtime = "nodejs"

type PaymentStatus = Database["public"]["Enums"]["payment_status"]

// Mapea el estado de MP a nuestro enum de payments.
function mapStatus(mp: string): PaymentStatus {
  switch (mp) {
    case "approved":
      return "paid"
    case "refunded":
    case "charged_back":
      return "refunded"
    case "rejected":
    case "cancelled":
      return "failed"
    default:
      return "pending" // pending / in_process / authorized
  }
}

/**
 * Webhook de Mercado Pago. MP nos avisa de un pago; nosotros re-consultamos el
 * pago con el token de la ORG (autoridad) y actualizamos payments + reserva.
 * Nunca confiamos en el cuerpo de la notificación.
 *
 * Respondemos 200 cuando la notificación ya se procesó o no hay nada que
 * hacer con ella, y 500 ante cualquier falla (API de MP caída, error de
 * base) para que MP la reintente con su backoff. Antes todo devolvía 200, y
 * una falla transitoria perdía la confirmación del pago para siempre
 * (auditoría M-07). Reintentar es seguro: cada paso de abajo es idempotente.
 */
export async function POST(request: Request) {
  const ok = () => NextResponse.json({ received: true })
  try {
    const url = new URL(request.url)
    const orgId = url.searchParams.get("org")

    const body = (await request.json().catch(() => ({}))) as {
      type?: string
      topic?: string
      action?: string
      data?: { id?: string | number }
      resource?: string
    }

    const type =
      url.searchParams.get("type") ||
      url.searchParams.get("topic") ||
      body.type ||
      body.topic
    // Sólo nos interesan notificaciones de pago.
    if (type && !type.includes("payment")) return ok()

    const paymentId =
      url.searchParams.get("data.id") ||
      url.searchParams.get("id") ||
      (body.data?.id != null ? String(body.data.id) : undefined)
    if (!orgId || !paymentId) return ok()

    const admin = createAdminClient()
    const cred = await getValidCredential(admin, orgId)
    if (!cred) return ok()

    const payment = await getPayment(cred.access_token, paymentId)
    const reservationId = payment.external_reference
    if (!reservationId) return ok()

    const newStatus = mapStatus(payment.status)

    // Acotado a la org de la URL: la reserva que nombra el pago tiene que ser
    // de la misma organización cuyo token acaba de validarlo (M-07).
    const { data: payRow, error: payErr } = await admin
      .from("payments")
      .select("id, status, amount, currency, paid_at")
      .eq("organization_id", orgId)
      .eq("reservation_id", reservationId)
      .eq("kind", "deposit")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (payErr) throw payErr
    if (!payRow) return ok()

    // Nunca confiamos en el body del webhook para confirmar: además del
    // status, el monto y la moneda tienen que coincidir con lo que ya
    // esperábamos cobrar. Si MP dice "approved" pero el importe no cierra,
    // dejamos rastro sin marcar el pago como acreditado ni tocar la reserva.
    let verifiedPaid = false
    if (newStatus === "paid") {
      const expected = Number(payRow.amount)
      const received = Number(payment.transaction_amount)
      const amountMatches =
        Number.isFinite(received) && Math.abs(received - expected) < 0.01
      const currencyMatches =
        !payment.currency_id ||
        payment.currency_id.toUpperCase() === String(payRow.currency).toUpperCase()
      verifiedPaid = amountMatches && currencyMatches
      if (!verifiedPaid) {
        console.error(
          `MP webhook: monto/moneda no coinciden para reserva ${reservationId} ` +
            `(payment ${paymentId}). Esperado ${expected} ${payRow.currency}, ` +
            `recibido ${received} ${payment.currency_id}.`
        )
      }
    }

    if (newStatus !== "paid" || verifiedPaid) {
      const { error } = await admin
        .from("payments")
        .update({
          status: newStatus,
          external_ref: paymentId,
          // No pisar paid_at en reintentos: MP puede reenviar la misma
          // notificación horas después y no queremos correr la fecha real.
          ...(newStatus === "paid" && !payRow.paid_at
            ? { paid_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", payRow.id)
      if (error) throw error
    } else {
      const { error } = await admin
        .from("payments")
        .update({ external_ref: paymentId })
        .eq("id", payRow.id)
      if (error) throw error
    }

    // Pago verificado → confirma la reserva (si todavía está esperando).
    if (verifiedPaid) {
      const { data: res, error: resErr } = await admin
        .from("reservations")
        .select("status")
        .eq("id", reservationId)
        .eq("organization_id", orgId)
        .maybeSingle()
      if (resErr) throw resErr

      if (res && (res.status === "pending" || res.status === "pending_payment")) {
        const { error } = await admin.rpc("transition_reservation", {
          p_reservation: reservationId,
          p_to: "confirmed",
        })
        if (error) throw error
      } else if (res?.status === "expired") {
        // El pago acreditó después de que venciera la retención (efectivo:
        // Rapipago, Pago Fácil). Si la fecha sigue libre, la reserva se
        // recupera y confirma; si ya se revendió, queda expirada con el pago
        // acreditado y hay que resolverlo a mano (auditoría A-02).
        const { data: outcome, error } = await admin.rpc(
          "recover_paid_expired_reservation",
          { p_reservation: reservationId }
        )
        if (error) throw error
        if (outcome === "UNAVAILABLE") {
          console.error(
            `MP webhook: el pago ${paymentId} acreditó sobre la reserva expirada ` +
              `${reservationId}, pero su fecha ya se revendió. Requiere reintegro ` +
              `o reubicación manual.`
          )
        }
      }
    }

    return ok()
  } catch (error) {
    console.error("MP webhook: falla al procesar; MP va a reintentar.", error)
    return NextResponse.json({ received: false }, { status: 500 })
  }
}
