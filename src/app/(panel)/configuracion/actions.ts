"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"
import { canManageSettings, SETTINGS_READ_ONLY_MESSAGE } from "@/lib/roles"
import { isCurrencyCode } from "@/lib/currencies"
import { applyDemoPropertyPatch } from "@/lib/demo/fixtures"
import { isDemoRequest, readDemoState, writeDemoState } from "@/lib/demo/session"

export type ActionResult = { ok: boolean; error?: string }

/** HH:MM (el input type=time puede venir vacío o manipulado). */
function parseTime(raw: FormDataEntryValue | null, fallback: string): string {
  const v = String(raw ?? "").trim()
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback
}

export async function updateProperty(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext()
  if (!canManageSettings(ctx.role)) return { ok: false, error: SETTINGS_READ_ONLY_MESSAGE }
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

  const currency = (() => {
    const c = String(formData.get("currency") ?? "").trim().toUpperCase()
    return isCurrencyCode(c) ? c : "ARS"
  })()
  const checkin_time = parseTime(formData.get("checkin_time"), "14:00")
  const checkout_time = parseTime(formData.get("checkout_time"), "10:00")

  if (await isDemoRequest()) {
    await writeDemoState(
      applyDemoPropertyPatch(await readDemoState(), {
        name,
        description: String(formData.get("description") ?? "").trim() || null,
        phone: String(formData.get("phone") ?? "").trim() || null,
        whatsapp: String(formData.get("whatsapp") ?? "").trim() || null,
        email: String(formData.get("email") ?? "").trim() || null,
        address: String(formData.get("address") ?? "").trim() || null,
        city: String(formData.get("city") ?? "").trim() || null,
        currency,
        checkin_time,
        checkout_time,
        deposit_pct,
      })
    )
    revalidatePath("/configuracion")
    revalidatePath("/")
    revalidatePath(`/reservar/${ctx.organizationSlug}`)
    return { ok: true }
  }

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
      // El <select> sólo restringe en el navegador: un código inválido rompe
      // Intl.NumberFormat y con él todos los importes de la app.
      currency,
      checkin_time,
      checkout_time,
      deposit_pct,
    })
    .eq("id", id)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/configuracion")
  revalidatePath("/")
  return { ok: true }
}

/** Desconecta la cuenta de Mercado Pago de la organización (borra credenciales). */
export async function disconnectMercadoPago(): Promise<ActionResult> {
  const ctx = await requireContext()
  if (!canManageSettings(ctx.role)) return { ok: false, error: SETTINGS_READ_ONLY_MESSAGE }
  const supabase = await createClient()

  const { error } = await supabase.rpc("mp_disconnect")
  if (error) return { ok: false, error: error.message }

  revalidatePath("/configuracion")
  return { ok: true }
}
