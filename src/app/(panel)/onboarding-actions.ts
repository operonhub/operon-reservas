"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { requireContext } from "@/lib/auth"
import { canManageSettings } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"

// La demo no tiene base real: el tour y la lista se recuerdan en el navegador.
const isDemo = async () => (await cookies()).get("operon_demo")?.value === "1"

export async function markLinkShared(): Promise<void> {
  if (await isDemo()) return
  const ctx = await requireContext()
  const supabase = await createClient()
  await supabase.rpc("org_onboarding_mark", { p_org: ctx.organizationId, p_event: "link_shared" })
  revalidatePath("/")
}

export async function dismissChecklist(): Promise<{ error?: string }> {
  if (await isDemo()) return {}
  const ctx = await requireContext()
  if (!canManageSettings(ctx.role)) {
    return { error: "Solo el dueño o un administrador puede ocultar la lista." }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("org_onboarding_mark", {
    p_org: ctx.organizationId,
    p_event: "checklist_dismissed",
  })
  if (error) return { error: "No se pudo ocultar la lista." }
  revalidatePath("/")
  return {}
}

export async function markTourCompleted(): Promise<void> {
  if (await isDemo()) return
  const supabase = await createClient()
  await supabase.rpc("mark_tour_completed")
  // Refresca el contexto del layout: si no, el tour volvería a arrancar solo.
  revalidatePath("/", "layout")
}
