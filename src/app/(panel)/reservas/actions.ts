"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"
import type { Enums } from "@/lib/supabase/types"

export type ActionResult = { ok: boolean; error?: string; id?: string }

export type GuestProfileReservation = {
  id: string
  code: string
  check_in: string
  check_out: string
  status: Enums<"reservation_status">
  total_amount: number | null
  currency: string
  units: { name: string } | { name: string }[] | null
}

export type GuestProfileResult =
  | {
      ok: true
      guest: {
        full_name: string
        email: string | null
        phone: string | null
        notes: string | null
      }
      reservations: GuestProfileReservation[]
    }
  | { ok: false; error: string }

function mapBookingError(message: string): string {
  if (message.includes("UNAVAILABLE"))
    return "Esas fechas ya están ocupadas para esa unidad."
  if (message.includes("OVER_CAPACITY"))
    return "La cantidad de huéspedes supera la capacidad de la unidad."
  if (message.includes("INVALID_DATES"))
    return "Las fechas ingresadas no son válidas."
  if (message.includes("UNIT_NOT_FOUND")) return "La unidad no existe."
  return message
}

export async function getGuestProfile(
  guestId: string
): Promise<GuestProfileResult> {
  await requireContext()
  const supabase = await createClient()

  if (!guestId) {
    return { ok: false, error: "No se pudo identificar al huésped." }
  }

  const [guestResult, reservationsResult] = await Promise.all([
    supabase
      .from("guests")
      .select("full_name, email, phone, notes")
      .eq("id", guestId)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(
        "id, code, check_in, check_out, status, total_amount, currency, units(name)"
      )
      .eq("guest_id", guestId)
      .order("check_in", { ascending: false }),
  ])

  if (guestResult.error || !guestResult.data || reservationsResult.error) {
    return { ok: false, error: "No se pudo cargar la información del huésped." }
  }

  return {
    ok: true,
    guest: guestResult.data,
    reservations: reservationsResult.data ?? [],
  }
}

export async function createManualReservation(
  formData: FormData
): Promise<ActionResult> {
  const ctx = await requireContext()
  const supabase = await createClient()

  const unit_id = String(formData.get("unit_id") ?? "")
  const full_name = String(formData.get("full_name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim() || null
  const phone = String(formData.get("phone") ?? "").trim() || null
  const check_in = String(formData.get("check_in") ?? "")
  const check_out = String(formData.get("check_out") ?? "")
  const guests = Number(formData.get("guests") ?? 1)
  const status = (String(formData.get("status") ?? "confirmed") ||
    "confirmed") as Enums<"reservation_status">
  const notes = String(formData.get("notes") ?? "").trim() || null

  if (!unit_id) return { ok: false, error: "Elegí una unidad." }
  if (!full_name) return { ok: false, error: "El nombre del huésped es obligatorio." }
  if (!check_in || !check_out) return { ok: false, error: "Completá las fechas." }
  if (check_out <= check_in)
    return { ok: false, error: "La salida debe ser posterior al ingreso." }

  // La unidad determina property y org (no confiamos en el cliente).
  const { data: unit } = await supabase
    .from("units")
    .select("id, property_id, capacity")
    .eq("id", unit_id)
    .maybeSingle()
  if (!unit) return { ok: false, error: "Unidad inválida." }

  const { data: reservation, error } = await supabase.rpc(
    "create_manual_reservation",
    {
      p_org: ctx.organizationId,
      p_property: unit.property_id,
      p_unit: unit_id,
      p_full_name: full_name,
      p_email: email,
      p_phone: phone,
      p_check_in: check_in,
      p_check_out: check_out,
      p_guests: Number.isFinite(guests) && guests > 0 ? Math.floor(guests) : 1,
      p_status: status,
      p_notes: notes,
    }
  )

  if (error) return { ok: false, error: mapBookingError(error.message) }

  // El precio y la seña los calcula _book en la base (fuente única de tarifas).
  const res = reservation as { id: string } | null

  revalidatePath("/reservas")
  revalidatePath("/calendario")
  revalidatePath("/")
  return { ok: true, id: res?.id }
}

export async function transitionReservation(
  id: string,
  to: Enums<"reservation_status">
): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()

  const { error } = await supabase.rpc("transition_reservation", {
    p_reservation: id,
    p_to: to,
  })
  if (error) {
    if (error.message.includes("INVALID_TRANSITION"))
      return { ok: false, error: "Esa transición de estado no está permitida." }
    if (error.message.includes("UNAVAILABLE"))
      return {
        ok: false,
        error: "No se puede reactivar: las fechas ya están ocupadas.",
      }
    return { ok: false, error: error.message }
  }

  revalidatePath("/reservas")
  revalidatePath(`/reservas/${id}`)
  revalidatePath("/calendario")
  revalidatePath("/")
  return { ok: true }
}
