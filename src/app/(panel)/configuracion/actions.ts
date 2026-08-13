"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"

export type ActionResult = { ok: boolean; error?: string }

export async function updateProperty(formData: FormData): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, error: "Falta el identificador." }

  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { ok: false, error: "El nombre es obligatorio." }

  const depositRaw = Number(formData.get("deposit_pct") ?? 0)
  const deposit_pct =
    Number.isFinite(depositRaw) && depositRaw >= 0 && depositRaw <= 100
      ? depositRaw
      : 0

  // RLS acota el update a la org del usuario.
  const { error } = await supabase
    .from("properties")
    .update({
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      whatsapp: String(formData.get("whatsapp") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      currency: String(formData.get("currency") ?? "ARS").trim() || "ARS",
      checkin_time: String(formData.get("checkin_time") ?? "14:00"),
      checkout_time: String(formData.get("checkout_time") ?? "10:00"),
      deposit_pct,
    })
    .eq("id", id)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/configuracion")
  revalidatePath("/")
  return { ok: true }
}
