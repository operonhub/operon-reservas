"use server"

import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"

export type SimulationNight = {
  day: string
  price: number | null
  base: number | null
  rule: {
    id: string
    label: string | null
    kind: string
    discount_pct: number | null
    price: number | null
  } | null
}

export type SimulationResult = {
  unit_id: string
  nights: number
  min_nights: number
  total: number | null
  currency: string
  breakdown: SimulationNight[]
}

export type SimulateResponse =
  | { ok: true; data: SimulationResult }
  | { ok: false; error: string }

/**
 * Corre el motor de precios para una estadía hipotética. La RPC valida que la
 * unidad sea de la organización del usuario (`is_member_of`), así que acá sólo
 * hace falta traducir los errores a algo legible.
 */
export async function simulatePrice(
  unitId: string,
  checkIn: string,
  checkOut: string,
  guests: number
): Promise<SimulateResponse> {
  await requireContext()
  if (!unitId) return { ok: false, error: "Elegí una unidad." }
  if (checkOut <= checkIn)
    return { ok: false, error: "La salida tiene que ser posterior al ingreso." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("simulate_price", {
    p_unit: unitId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_guests: Math.max(1, Math.floor(guests) || 1),
  })

  if (error) {
    const msg = error.message.includes("INVALID_DATES")
      ? "Las fechas no son válidas."
      : error.message.includes("FORBIDDEN")
        ? "Esa unidad no es de tu alojamiento."
        : "No se pudo calcular el precio."
    return { ok: false, error: msg }
  }

  return { ok: true, data: data as unknown as SimulationResult }
}
