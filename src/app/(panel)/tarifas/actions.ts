"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"
import type { Enums } from "@/lib/supabase/types"

export type ActionResult = { ok: boolean; error?: string }

function parseForm(formData: FormData) {
  const kind = (String(formData.get("kind") ?? "base") || "base") as Enums<"rate_kind">
  const unitRaw = String(formData.get("unit_id") ?? "")
  const price = Number(formData.get("price_per_night") ?? 0)
  const minNights = Number(formData.get("min_nights") ?? 1)
  const priority = Number(formData.get("priority") ?? 0)
  const start = String(formData.get("start_date") ?? "").trim() || null
  const end = String(formData.get("end_date") ?? "").trim() || null

  return {
    kind,
    unit_id: unitRaw || null, // "" = toda la propiedad
    price_per_night: Number.isFinite(price) && price >= 0 ? price : 0,
    min_nights: Number.isFinite(minNights) && minNights >= 1 ? Math.floor(minNights) : 1,
    priority: Number.isFinite(priority) ? Math.floor(priority) : 0,
    start_date: kind === "base" ? null : start,
    end_date: kind === "base" ? null : end,
  }
}

function validate(v: ReturnType<typeof parseForm>): string | null {
  if (v.price_per_night <= 0) return "El precio por noche debe ser mayor a 0."
  if (v.kind !== "base") {
    if (!v.start_date || !v.end_date)
      return "Las tarifas de temporada/especiales necesitan fecha de inicio y fin."
    if (v.end_date < v.start_date) return "La fecha de fin no puede ser anterior al inicio."
  }
  return null
}

export async function createRate(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext()
  const supabase = await createClient()

  const property_id = String(formData.get("property_id") ?? "")
  if (!property_id) return { ok: false, error: "Falta la propiedad." }

  const v = parseForm(formData)
  const err = validate(v)
  if (err) return { ok: false, error: err }

  const { error } = await supabase.from("rates").insert({
    organization_id: ctx.organizationId,
    property_id,
    unit_id: v.unit_id,
    kind: v.kind,
    price_per_night: v.price_per_night,
    min_nights: v.min_nights,
    priority: v.priority,
    start_date: v.start_date,
    end_date: v.end_date,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/tarifas")
  return { ok: true }
}

export async function updateRate(formData: FormData): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, error: "Falta el identificador." }

  const v = parseForm(formData)
  const err = validate(v)
  if (err) return { ok: false, error: err }

  const { error } = await supabase
    .from("rates")
    .update({
      unit_id: v.unit_id,
      kind: v.kind,
      price_per_night: v.price_per_night,
      min_nights: v.min_nights,
      priority: v.priority,
      start_date: v.start_date,
      end_date: v.end_date,
    })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/tarifas")
  return { ok: true }
}

export async function deleteRate(id: string): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()
  const { error } = await supabase.from("rates").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/tarifas")
  return { ok: true }
}
