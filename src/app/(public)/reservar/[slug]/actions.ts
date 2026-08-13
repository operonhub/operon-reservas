"use server"

import { createClient } from "@/lib/supabase/server"

// Estas acciones corren como rol anon (sin sesión) y sólo llaman a las RPC
// públicas, que devuelven exclusivamente información pública.

export type AvailUnit = {
  unit_id: string
  name: string
  description: string | null
  capacity: number
  price_per_night: number
  currency: string
}

export type SearchResult = { ok: boolean; error?: string; units?: AvailUnit[] }

export async function searchAvailability(
  orgSlug: string,
  checkIn: string,
  checkOut: string,
  guests: number
): Promise<SearchResult> {
  if (!checkIn || !checkOut) return { ok: false, error: "Elegí las fechas." }
  if (checkOut <= checkIn)
    return { ok: false, error: "La salida debe ser posterior al ingreso." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("public_availability", {
    p_org_slug: orgSlug,
    p_property_slug: null,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_guests: Number.isFinite(guests) && guests > 0 ? Math.floor(guests) : 1,
  })

  if (error) return { ok: false, error: "No se pudo consultar la disponibilidad." }
  return { ok: true, units: (data ?? []) as AvailUnit[] }
}

export type BookResult = { ok: boolean; error?: string; code?: string }

export async function bookPublic(input: {
  orgSlug: string
  unitId: string
  checkIn: string
  checkOut: string
  guests: number
  fullName: string
  email: string
  phone: string
  notes: string
}): Promise<BookResult> {
  if (!input.fullName.trim()) return { ok: false, error: "Ingresá tu nombre." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_public_reservation", {
    p_org_slug: input.orgSlug,
    p_property_slug: null,
    p_unit_id: input.unitId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_guests: input.guests,
    p_full_name: input.fullName.trim(),
    p_email: input.email.trim() || null,
    p_phone: input.phone.trim() || null,
    p_notes: input.notes.trim() || null,
  })

  if (error) {
    const msg = error.message.includes("UNAVAILABLE")
      ? "Esa unidad ya se reservó para esas fechas. Probá con otras."
      : "No se pudo generar la reserva."
    return { ok: false, error: msg }
  }

  const res = data as { code?: string } | null
  return { ok: true, code: res?.code }
}
