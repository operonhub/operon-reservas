"use server"

import { createClient } from "@/lib/supabase/server"

// Corre como anon: solo llama a la RPC pública, que devuelve exclusivamente
// campos seguros para mostrarle al huésped (ver 0013).

export type PublicReservationStatus = {
  code: string
  status: string
  property_name: string
  property_whatsapp: string | null
  unit_name: string
  check_in: string
  check_out: string
  guests_count: number
  total_amount: number | null
  deposit_amount: number | null
  deposit_paid: number
  currency: string
}

export type StatusResult =
  | { ok: true; reservation: PublicReservationStatus }
  | { ok: false; error: string }

/**
 * Estado REAL de la reserva contra la base. La página /pago nunca debe
 * confiar solo en el query param que devuelve Mercado Pago al redirigir:
 * el webhook puede confirmar antes o después de que el huésped vuelva.
 */
export async function getReservationStatus(
  orgSlug: string,
  code: string
): Promise<StatusResult> {
  if (!orgSlug || !code) return { ok: false, error: "Faltan datos de la reserva." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("public_reservation_status", {
    p_org_slug: orgSlug,
    p_code: code,
  })

  if (error || !data) return { ok: false, error: "No encontramos esa reserva." }
  return { ok: true, reservation: data as PublicReservationStatus }
}
