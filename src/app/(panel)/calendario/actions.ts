"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"

export type ActionResult = { ok: boolean; error?: string }

export async function createBlock(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext()
  const supabase = await createClient()

  const unit_id = String(formData.get("unit_id") ?? "")
  const start = String(formData.get("start") ?? "")
  const end = String(formData.get("end") ?? "")
  const reason = String(formData.get("reason") ?? "").trim() || null

  if (!unit_id || !start || !end)
    return { ok: false, error: "Completá unidad y fechas." }
  if (end <= start)
    return { ok: false, error: "La fecha de fin debe ser posterior al inicio." }

  // create_block valida membership en la base y usa la restricción EXCLUDE.
  const { error } = await supabase.rpc("create_block", {
    p_org: ctx.organizationId,
    p_unit: unit_id,
    p_start: start,
    p_end: end,
    p_reason: reason,
  })

  if (error) {
    const msg = error.message.includes("UNAVAILABLE")
      ? "Esas fechas ya están ocupadas por una reserva u otro bloqueo."
      : error.message
    return { ok: false, error: msg }
  }

  revalidatePath("/calendario")
  return { ok: true }
}

export async function deleteBlock(id: string): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()

  // Solo bloqueos (kind='block'); las reservas se liberan cancelándolas.
  // RLS acota el delete a la org del usuario.
  const { error } = await supabase
    .from("unit_occupancy")
    .delete()
    .eq("id", id)
    .eq("kind", "block")
  if (error) return { ok: false, error: error.message }

  revalidatePath("/calendario")
  return { ok: true }
}
