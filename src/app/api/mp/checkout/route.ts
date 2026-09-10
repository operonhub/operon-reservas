import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getValidCredential } from "@/lib/mp-credential"
import { createPreference, siteUrl } from "@/lib/mercadopago"
import type { Database } from "@/lib/supabase/types"
import type { SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const HOLD_MINUTES_ON_CHECKOUT = 15

/** Reinicia la retención de la unidad al iniciar (o reintentar) el pago. */
function bumpHold(admin: SupabaseClient<Database>, reservationId: string) {
  return admin
    .from("reservations")
    .update({
      hold_expires_at: new Date(
        Date.now() + HOLD_MINUTES_ON_CHECKOUT * 60_000
      ).toISOString(),
    })
    .eq("id", reservationId)
}

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
  let body: { code?: string; orgSlug?: string }
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

  // Idempotencia: reusar la seña pendiente y su link si ya existe.
  // order + limit: aunque quedaran duplicados de antes, maybeSingle() nunca
  // ve más de una fila. Antes, con dos filas devolvía error, el error se
  // descartaba y cada pedido creaba otra seña y otra preferencia (M-06).
  const pendingDeposit = () =>
    admin
      .from("payments")
      .select("id, mp_init_point")
      .eq("reservation_id", r.id)
      .eq("kind", "deposit")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

  let { data: deposit, error: depositErr } = await pendingDeposit()
  if (depositErr) return fail(500, "NO_SE_PUDO_REGISTRAR_PAGO")

  if (!deposit) {
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
      .select("id, mp_init_point")
      .single()
    if (insErr?.code === "23505") {
      // Otro pedido de esta misma reserva la creó en paralelo (doble click):
      // el índice único de la 0024 frenó el duplicado, así que se usa esa.
      const retry = await pendingDeposit()
      deposit = retry.data
      depositErr = retry.error
    } else {
      deposit = inserted
      depositErr = insErr
    }
    if (depositErr || !deposit) return fail(500, "NO_SE_PUDO_REGISTRAR_PAGO")
  }

  if (deposit.mp_init_point) {
    await bumpHold(admin, r.id)
    return NextResponse.json(
      { ok: true, init_point: deposit.mp_init_point },
      { headers: CORS }
    )
  }
  const paymentId = deposit.id

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
    // El código es único solo DENTRO de cada org (unique (organization_id,
    // code)), no globalmente — /pago necesita el slug para no ambigüar
    // reservas de distintos alojamientos con el mismo código.
    //
    // La vuelta es SIEMPRE nuestra /pago. Antes se aceptaba un `returnUrl`
    // del cuerpo: como este endpoint es público y el init_point se guarda y
    // se reutiliza, cualquiera podía dejar el link de pago de otro huésped
    // apuntando a su sitio (auditoría A-03). Ningún llamador lo usaba.
    const back = `${site}/pago?code=${encodeURIComponent(code)}&org=${encodeURIComponent(orgSlug)}`

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

    // Reloj de retención fresco: el huésped recién ahora va a pagar de
    // verdad, no debería heredar el tiempo que ya gastó llenando el
    // formulario. expire_stale_holds (0012) libera la unidad si lo deja
    // vencer acá también.
    await bumpHold(admin, r.id)

    return NextResponse.json({ ok: true, init_point: initPoint }, { headers: CORS })
  } catch {
    return fail(502, "MERCADOPAGO_NO_DISPONIBLE")
  }
}
