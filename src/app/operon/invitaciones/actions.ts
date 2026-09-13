"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { generateToken, hashToken } from "@/lib/invitations"
import { siteUrl } from "@/lib/site-url"

export type CreateInvitationState = { link?: string; note?: string; error?: string } | null

/** Las RPC verifican is_platform_admin(); la demo no tiene Auth real. */
async function operonClient() {
  if ((await cookies()).get("operon_demo")?.value === "1") return null
  return createClient()
}

export async function createInvitation(
  _prev: CreateInvitationState,
  formData: FormData
): Promise<CreateInvitationState> {
  const note = String(formData.get("note") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  if (note.length < 2) return { error: "Poné el nombre del cliente para reconocer la invitación." }

  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }

  const token = generateToken()
  const { error } = await supabase.rpc("invitation_create", {
    p_token_hash: hashToken(token),
    p_email: email || undefined,
    p_note: note,
  })
  if (error) {
    if (error.message.includes("INVALID_EMAIL")) return { error: "Revisá el email." }
    if (error.message.includes("FORBIDDEN")) return { error: "Tu usuario no puede crear invitaciones." }
    return { error: "No se pudo crear la invitación. Probá de nuevo." }
  }

  revalidatePath("/operon/invitaciones")
  // El token no se guarda en ningún lado: esta es la única vez que existe entero.
  return { link: `${await siteUrl()}/invitacion/${token}`, note }
}

export async function revokeInvitation(id: string): Promise<{ error?: string }> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const { error } = await supabase.rpc("invitation_revoke", { p_id: id })
  if (error) return { error: "No se pudo anular la invitación." }
  revalidatePath("/operon/invitaciones")
  return {}
}
