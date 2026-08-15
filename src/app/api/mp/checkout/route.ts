import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getValidCredential } from "@/lib/mp-credential"
import { createPreference, siteUrl } from "@/lib/mercadopago"

export const runtime = "nodejs"

// La landing de cada cabaña (otro dominio) llama a este endpoint → CORS abierto.
// Sólo devuelve un link de pago a partir de un código de reserva; no hay datos
// sensibles ni cobro directo.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: CORS })
}

/**
 * Crea (o reutiliza) una preferencia de Mercado Pago para cobrar la seña de
 * una reserva y devuelve el `init_point`. El dinero va a la cuenta de la org.
 */
export async function POST(request: Request) {
  let body: { code?: string; orgSlug?: string; returnUrl?: string }
  try {
    body = await request.json()
  } catch {
    return fail(400, "BODY_INVALIDO")
  }
  const code = body.code?.trim()
  const orgSlug = body.orgSlug?.trim()
  if (!code || !orgSlug) return fail(400, "FALTAN_DATOS")

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(500, "PAGOS_NO_CONFIGURADOS")
  }
  const admin = createAdminClient()

  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("slug", orgSlug)
    .maybeSingle()
  if (!org) return fail(404, "ORG_NO_ENCONTRADA")

  const { data: r } = await admin
    .from("reservations")
    .select("id, status, total_amount, deposit_amount, currency, guest_id")
    .eq("organization_id", org.id)
    .eq("code", code)
    .maybeSingle()
  if (!r) return fail(404, "RESERVA_NO_ENCONTRADA")
  if (r.status !== "pending" && r.status !== "pending_payment") {
    return fail(409, "RESERVA_NO_PAGABLE")
  }

  const amount =
    r.deposit_amount && r.deposit_amount > 0 ? r.deposit_amount : r.total_amount
  if (!amount || amount <= 0) return fail(422, "SIN_MONTO")

  const cred = await getValidCredential(admin, org.id)
  if (!cred) return fail(409, "ORG_SIN_MERCADOPAGO")

  // Idempotencia: reusar el pago pendiente y su link si ya existe.
  const { data: existing } = await admin
    .from("payments")
    .select("id, mp_init_point")
    .eq("reservation_id", r.id)
    .eq("kind", "deposit")
    .eq("status", "pending")
    .maybeSingle()

  if (existing?.mp_init_point) {
    return NextResponse.json(
      { ok: true, init_point: existing.mp_init_point },
      { headers: CORS }
    )
  }

  let paymentId = existing?.id
  if (!paymentId) {
    const { data: inserted, error: insErr } = await admin
      .from("payments")
      .insert({
        organization_id: org.id,
        reservation_id: r.id,
        kind: "deposit",
        amount,
        currency: r.currency,
        status: "pending",
        method: "mercadopago",
      })
      .select("id")
      .single()
    if (insErr || !inserted) return fail(500, "NO_SE_PUDO_REGISTRAR_PAGO")
    paymentId = inserted.id
  }

  let payerEmail: string | undefined
  if (r.guest_id) {
    const { data: g } = await admin
      .from("guests")
      .select("email")
      .eq("id", r.guest_id)
      .maybeSingle()
    payerEmail = g?.email ?? undefined
  }

  try {
    const site = siteUrl()
    const back =
      body.returnUrl?.trim() || `${site}/pago?code=${encodeURIComponent(code)}`

    const pref = await createPreference(
      cred.access_token,
      {
        items: [
          {
            title: `Reserva ${code} — ${org.name}`,
            quantity: 1,
            unit_price: Number(amount),
            currency_id: r.currency,
          },
        ],
        external_reference: r.id,
        notification_url: `${site}/api/mp/webhook?org=${org.id}`,
        back_urls: { success: back, pending: back, failure: back },
        auto_return: "approved",
        ...(payerEmail ? { payer: { email: payerEmail } } : {}),
        metadata: { reservation_id: r.id, payment_id: paymentId },
      },
      paymentId
    )

    const initPoint = cred.live_mode ? pref.init_point : pref.sandbox_init_point

    await admin
      .from("payments")
      .update({ mp_preference_id: pref.id, mp_init_point: initPoint })
      .eq("id", paymentId)

    // Mueve la reserva a "esperando pago" (si aún no lo estaba).
    if (r.status === "pending") {
      await admin.rpc("transition_reservation", {
        p_reservation: r.id,
        p_to: "pending_payment",
      })
    }

    return NextResponse.json({ ok: true, init_point: initPoint }, { headers: CORS })
  } catch {
    return fail(502, "MERCADOPAGO_NO_DISPONIBLE")
  }
}
