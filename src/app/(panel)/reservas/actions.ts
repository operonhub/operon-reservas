"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"
import type { Enums } from "@/lib/supabase/types"
import {
  applyDemoDelete,
  applyDemoManualReservation,
  applyDemoMovement,
  applyDemoTransition,
  applyDemoUpdate,
  demoStayPrice,
} from "@/lib/demo/fixtures"
import { isDemoRequest, readDemoState, writeDemoState } from "@/lib/demo/session"
import { canDeleteReservations, DELETE_RESERVATION_FORBIDDEN_MESSAGE } from "@/lib/roles"
import { toAuditEntries, type AuditEntry } from "@/lib/reservation-rules"

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

/**
 * Lo que devuelve la base (códigos como UNAVAILABLE) dicho en criollo. Un error
 * que no reconocemos no se muestra crudo: es un mensaje técnico que no le sirve
 * a quien está usando el panel.
 */
function mapReservationError(message: string): string {
  const minNights = message.match(/MIN_NIGHTS:(\d+)/)
  if (minNights) return `Para esas fechas la estadía mínima es de ${minNights[1]} noches.`
  const known: [string, string][] = [
    ["UNAVAILABLE", "Esas fechas ya están ocupadas para esa unidad."],
    ["OVER_CAPACITY", "La cantidad de huéspedes supera la capacidad de la unidad."],
    ["INVALID_DATES", "Las fechas ingresadas no son válidas."],
    ["UNIT_NOT_FOUND", "La unidad no existe o está inactiva."],
    ["INVALID_GUESTS", "La cantidad de huéspedes tiene que ser de al menos 1."],
    ["NAME_REQUIRED", "El nombre del huésped es obligatorio."],
    ["NOT_FOUND", "No encontramos la reserva. Puede que ya la hayan eliminado."],
    ["FORBIDDEN", "No tenés permiso para hacer esto."],
    ["NOT_EDITABLE", "Una reserva cancelada o expirada ya no se puede editar."],
    ["INVALID_TRANSITION", "Esa transición de estado no está permitida."],
    [
      "HAS_PAYMENTS",
      "Esta reserva tiene pagos registrados, así que no se puede eliminar. Cancelala: queda en el historial.",
    ],
    [
      "HAS_OPEN_CHECKOUT",
      "Tiene un link de pago de Mercado Pago abierto: si la eliminás y la persona paga igual, el cobro entraría sin reserva. Cancelala para conservar el registro.",
    ],
  ]
  const hit = known.find(([code]) => message.includes(code))
  return hit ? hit[1] : "No se pudo completar. Probá de nuevo."
}

function revalidateReservation(id?: string) {
  revalidatePath("/reservas")
  if (id) revalidatePath(`/reservas/${id}`)
  revalidatePath("/calendario")
  revalidatePath("/")
}

export async function getGuestProfile(
  guestId: string
): Promise<GuestProfileResult> {
  const ctx = await requireContext()
  const supabase = await createClient()

  if (!guestId) {
    return { ok: false, error: "No se pudo identificar al huésped." }
  }

  const [guestResult, reservationsResult] = await Promise.all([
    supabase
      .from("guests")
      .select("full_name, email, phone, notes")
      .eq("organization_id", ctx.organizationId)
      .eq("id", guestId)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select(
        "id, code, check_in, check_out, status, total_amount, currency, units(name)"
      )
      .eq("organization_id", ctx.organizationId)
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

  if (await isDemoRequest()) {
    const result = applyDemoManualReservation(await readDemoState(), { unitId: unit_id, fullName: full_name, email, phone, checkIn: check_in, checkOut: check_out, guests, status, notes })
    if (!result) return { ok: false, error: "Unidad inválida." }
    await writeDemoState(result.state)
    revalidatePath("/reservas")
    revalidatePath("/calendario")
    revalidatePath("/")
    return { ok: true, id: result.id }
  }

  // La unidad determina property y org (no confiamos en el cliente).
  const { data: unit } = await supabase
    .from("units")
    .select("id, property_id, capacity")
    .eq("organization_id", ctx.organizationId)
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

  if (error) return { ok: false, error: mapReservationError(error.message) }

  // El precio y la seña los calcula _book en la base (fuente única de tarifas).
  const res = reservation as { id: string } | null

  revalidatePath("/reservas")
  revalidatePath("/calendario")
  revalidatePath("/")
  return { ok: true, id: res?.id }
}

/**
 * Cambia el estado de una reserva. `notifyGuest: false` evita el mail al
 * huésped por ese cambio (al cancelar: casilla del diálogo). Reabrir una
 * "Completada" nunca avisa: la base lo decide sola.
 */
export async function transitionReservation(
  id: string,
  to: Enums<"reservation_status">,
  options?: { notifyGuest?: boolean }
): Promise<ActionResult> {
  if (await isDemoRequest()) {
    const next = applyDemoTransition(await readDemoState(), id, to)
    if (!next) return { ok: false, error: "No se encontró la reserva ficticia." }
    await writeDemoState(next)
    revalidateReservation(id)
    return { ok: true }
  }
  await requireContext()
  const supabase = await createClient()

  const { error } = await supabase.rpc("transition_reservation", {
    p_reservation: id,
    p_to: to,
    p_notify: options?.notifyGuest ?? true,
  })
  if (error) {
    if (error.message.includes("UNAVAILABLE"))
      return {
        ok: false,
        error: "No se puede reactivar: las fechas ya están ocupadas.",
      }
    return { ok: false, error: mapReservationError(error.message) }
  }

  revalidateReservation(id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

export type UpdateSummary = {
  changed: boolean
  code: string
  total: number | null
  deposit: number | null
  paid: number
  /** total − cobrado; negativo = se cobró de más; null si no hay total. */
  balance: number | null
  currency: string
  noPrice: boolean
}
export type UpdateReservationResult = { ok: boolean; error?: string; summary?: UpdateSummary }

export async function updateReservation(formData: FormData): Promise<UpdateReservationResult> {
  const id = String(formData.get("id") ?? "")
  const unitId = String(formData.get("unit_id") ?? "")
  const checkIn = String(formData.get("check_in") ?? "")
  const checkOut = String(formData.get("check_out") ?? "")
  const guests = Math.floor(Number(formData.get("guests") ?? 0))
  const fullName = String(formData.get("full_name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim() || null
  const phone = String(formData.get("phone") ?? "").trim() || null
  const notes = String(formData.get("notes") ?? "").trim() || null

  if (!id) return { ok: false, error: "No se pudo identificar la reserva." }
  if (!unitId) return { ok: false, error: "Elegí una unidad." }
  if (!fullName) return { ok: false, error: "El nombre del huésped es obligatorio." }
  if (!checkIn || !checkOut) return { ok: false, error: "Completá las fechas." }
  if (checkOut <= checkIn) return { ok: false, error: "La salida debe ser posterior al ingreso." }
  if (!Number.isFinite(guests) || guests < 1) {
    return { ok: false, error: "La cantidad de huéspedes tiene que ser de al menos 1." }
  }

  if (await isDemoRequest()) {
    const result = applyDemoUpdate(await readDemoState(), id, { unitId, checkIn, checkOut, guests, fullName, email, phone, notes })
    if (!result.ok) return result
    await writeDemoState(result.state)
    revalidateReservation(id)
    const s = result.summary
    return {
      ok: true,
      summary: { changed: s.changed, code: s.code, total: s.total, deposit: s.deposit, paid: s.paid, balance: s.balance, currency: s.currency, noPrice: false },
    }
  }

  await requireContext()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("update_reservation", {
    p_reservation: id,
    p_unit: unitId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_guests: guests,
    p_full_name: fullName,
    p_email: email,
    p_phone: phone,
    p_notes: notes,
  })
  if (error) return { ok: false, error: mapReservationError(error.message) }

  const r = (data ?? {}) as {
    changed?: boolean
    code?: string
    total_amount?: number | null
    deposit_amount?: number | null
    paid_amount?: number
    balance?: number | null
    currency?: string
    no_price?: boolean
  }
  revalidateReservation(id)
  return {
    ok: true,
    summary: {
      changed: Boolean(r.changed),
      code: r.code ?? "",
      total: r.total_amount == null ? null : Number(r.total_amount),
      deposit: r.deposit_amount == null ? null : Number(r.deposit_amount),
      paid: Number(r.paid_amount ?? 0),
      balance: r.balance == null ? null : Number(r.balance),
      currency: r.currency ?? "ARS",
      noPrice: Boolean(r.no_price),
    },
  }
}

export type PricePreview =
  | { ok: true; total: number | null; currency: string; nights: number; minNights: number | null }
  | { ok: false; error: string }

/**
 * Cuánto saldría la estadía con esos datos, antes de guardar: el mismo cálculo
 * del simulador de tarifas (que usa la función de precios de la base).
 */
export async function previewReservationPrice(input: {
  unitId: string
  checkIn: string
  checkOut: string
  guests: number
}): Promise<PricePreview> {
  const { unitId, checkIn, checkOut } = input
  const guests = Math.floor(Number(input.guests))
  if (!unitId || !checkIn || !checkOut || checkOut <= checkIn || !(guests >= 1)) {
    return { ok: false, error: "Completá fechas y huéspedes para ver el precio." }
  }
  const nights = Math.round((Date.parse(checkOut + "T00:00:00Z") - Date.parse(checkIn + "T00:00:00Z")) / 86400000)

  if (await isDemoRequest()) {
    const price = demoStayPrice(await readDemoState(), unitId, nights)
    return { ok: true, total: price.total, currency: "ARS", nights, minNights: null }
  }

  await requireContext()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("simulate_price", {
    p_unit: unitId,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_guests: guests,
  })
  if (error) return { ok: false, error: mapReservationError(error.message) }
  const r = data as {
    total?: number | null
    currency?: string
    min_nights?: number | null
    breakdown?: { price: number | null }[]
  } | null
  const priced = (r?.breakdown ?? []).every((n) => n.price != null) && (r?.breakdown ?? []).length > 0
  return {
    ok: true,
    total: priced && r?.total != null ? Number(r.total) : null,
    currency: r?.currency ?? "ARS",
    nights,
    minNights: r?.min_nights == null ? null : Number(r.min_nights),
  }
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

/**
 * Elimina una reserva y todo lo que colgaba de ella. Solo dueño o
 * administrador, y solo si no hubo plata de por medio: la base lo impone
 * (delete_reservation); esto devuelve el mensaje claro sin llegar a ella.
 */
export async function deleteReservation(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: "No se pudo identificar la reserva." }
  const ctx = await requireContext()
  if (!canDeleteReservations(ctx.role)) return { ok: false, error: DELETE_RESERVATION_FORBIDDEN_MESSAGE }

  if (await isDemoRequest()) {
    const result = applyDemoDelete(await readDemoState(), id)
    if (!result.ok) return result
    await writeDemoState(result.state)
    revalidateReservation(id)
    return { ok: true }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_reservation", { p_reservation: id })
  if (error) return { ok: false, error: mapReservationError(error.message) }
  revalidateReservation(id)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Historial de cambios
// ---------------------------------------------------------------------------

export type ReservationAuditResult = { ok: true; entries: AuditEntry[] } | { ok: false; error: string }

/** Qué se editó, canceló, reabrió o eliminó (solo dueño o administrador). */
export async function getReservationAudit(reservationId?: string): Promise<ReservationAuditResult> {
  const ctx = await requireContext()
  if (!canDeleteReservations(ctx.role)) {
    return { ok: false, error: "Solo el dueño o un administrador puede ver el historial de cambios." }
  }
  if (await isDemoRequest()) return { ok: true, entries: [] }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("reservation_audit_log", {
    p_org: ctx.organizationId,
    p_reservation: reservationId ?? null,
    p_limit: 100,
  })
  if (error) return { ok: false, error: "No se pudo cargar el historial." }
  return { ok: true, entries: toAuditEntries(data) }
}

// ---------------------------------------------------------------------------
// Ingreso y salida
// ---------------------------------------------------------------------------

export type ReservationMovement = "checkin" | "checkout"

/** Registra el momento real de ingreso o salida sin alterar estado ni fechas.
 * El estado `completed` se mantiene como transición administrativa separada,
 * porque también representa el cierre del circuito de la reserva y sus pagos.
 *
 * Va por una función de la base (record_reservation_movement, 0046): el
 * update directo que hacía antes lo descartaba en silencio la política de
 * solo lectura de `reservations`, y parecía guardar sin guardar.
 */
export async function recordReservationMovement(
  id: string,
  movement: ReservationMovement
): Promise<ActionResult> {
  if (!id || !["checkin", "checkout"].includes(movement)) {
    return { ok: false, error: "Movimiento inválido." }
  }

  if (await isDemoRequest()) {
    const result = applyDemoMovement(await readDemoState(), id, movement, new Date().toISOString())
    if (!result.ok) return result
    await writeDemoState(result.state)
    revalidatePath(`/reservas/${id}`)
    revalidatePath("/reservas")
    revalidatePath("/")
    return { ok: true }
  }

  await requireContext()
  const supabase = await createClient()
  const { error } = await supabase.rpc("record_reservation_movement", {
    p_reservation: id,
    p_movement: movement,
  })
  if (error) {
    if (error.message.includes("ALREADY_RECORDED")) {
      return {
        ok: false,
        error: movement === "checkin" ? "El ingreso ya estaba registrado." : "La salida ya estaba registrada.",
      }
    }
    if (error.message.includes("NOT_EDITABLE")) {
      return { ok: false, error: "Una reserva cancelada o expirada no tiene movimientos operativos." }
    }
    return { ok: false, error: mapReservationError(error.message) }
  }

  revalidatePath(`/reservas/${id}`)
  revalidatePath("/reservas")
  revalidatePath("/")
  return { ok: true }
}
