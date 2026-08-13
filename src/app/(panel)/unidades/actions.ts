"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"

export type ActionResult = { ok: boolean; error?: string }

function parseCapacity(raw: FormDataEntryValue | null): number {
  const n = Number(raw ?? 1)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

/** Verifica que la property pertenezca a la org del usuario (defensa en profundidad). */
async function assertProperty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string
) {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle() // RLS: solo devuelve si es de la org del usuario
  return !!data
}

export async function createUnit(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext()
  const supabase = await createClient()

  const property_id = String(formData.get("property_id") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim() || null
  const capacity = parseCapacity(formData.get("capacity"))

  if (!name) return { ok: false, error: "El nombre es obligatorio." }
  if (!property_id || !(await assertProperty(supabase, property_id)))
    return { ok: false, error: "Propiedad inválida." }

  const { error } = await supabase.from("units").insert({
    organization_id: ctx.organizationId, // derivado del membership, no del cliente
    property_id,
    name,
    description,
    capacity,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/unidades")
  return { ok: true }
}

export async function updateUnit(formData: FormData): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim() || null
  const capacity = parseCapacity(formData.get("capacity"))
  const is_active = formData.get("is_active") === "on"

  if (!id) return { ok: false, error: "Falta el identificador." }
  if (!name) return { ok: false, error: "El nombre es obligatorio." }

  // RLS acota el update a la org del usuario.
  const { error } = await supabase
    .from("units")
    .update({ name, description, capacity, is_active })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/unidades")
  revalidatePath("/calendario")
  return { ok: true }
}

export async function toggleUnitActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()

  const { error } = await supabase
    .from("units")
    .update({ is_active: isActive })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/unidades")
  revalidatePath("/calendario")
  return { ok: true }
}
