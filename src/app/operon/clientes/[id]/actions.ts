"use server"

import { revalidatePath } from "next/cache"
import { operonClient, rpcErrorCode } from "@/lib/operon/client"
import { createAdminClient } from "@/lib/supabase/admin"
import { siteUrl } from "@/lib/site-url"

/**
 * Acciones de la ficha de un cliente. Todas pasan por RPC con la sesión del
 * admin: la base verifica is_platform_admin() y deja el registro en la misma
 * transacción que el cambio. El service role aparece solo para generar el
 * link de contraseña, y DESPUÉS de que la RPC autorizó y registró.
 */

export type ActionState = { ok?: boolean; error?: string } | null
export type RecoveryState = { link?: string; email?: string; error?: string } | null

const MESSAGES: Record<string, string> = {
  FORBIDDEN: "No tenés permiso para hacer esto.",
  ORG_NOT_FOUND: "No encontramos el complejo.",
  REASON_REQUIRED: "Escribí el motivo (entre 3 y 500 caracteres).",
  REASON_TOO_LONG: "El motivo es demasiado largo.",
  ALREADY_SUSPENDED: "El complejo ya estaba suspendido.",
  NOT_SUSPENDED: "El complejo ya estaba activo.",
  NOT_A_MEMBER: "Esa persona ya no es parte del equipo.",
  LAST_OWNER: "Es el único dueño: no se puede quitar. Primero sumá o asigná otro dueño.",
  TARGET_IS_PLATFORM_ADMIN: "Es admin de Operon: su contraseña no se maneja desde acá.",
  NO_EMAIL: "Esa cuenta no tiene email.",
}

function toError(message: string | undefined) {
  const code = rpcErrorCode(message, Object.keys(MESSAGES))
  return code ? MESSAGES[code] : "No se pudo completar. Probá de nuevo."
}

function field(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function refresh(orgId: string) {
  revalidatePath(`/operon/clientes/${orgId}`)
  revalidatePath("/operon")
  revalidatePath("/operon/actividad")
}

export async function suspendOrg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const reason = field(formData, "reason")
  if (reason.length < 3) return { error: MESSAGES.REASON_REQUIRED }

  const { error } = await supabase.rpc("operon_suspend_org", { p_org: orgId, p_reason: reason })
  if (error) return { error: toError(error.message) }
  refresh(orgId)
  return { ok: true }
}

export async function reactivateOrg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const reason = field(formData, "reason")

  const { error } = await supabase.rpc("operon_reactivate_org", {
    p_org: orgId,
    p_reason: reason || undefined,
  })
  if (error) return { error: toError(error.message) }
  refresh(orgId)
  return { ok: true }
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const reason = field(formData, "reason")
  if (reason.length < 3) return { error: MESSAGES.REASON_REQUIRED }

  const { error } = await supabase.rpc("operon_remove_member", {
    p_org: orgId,
    p_user: field(formData, "user"),
    p_reason: reason,
  })
  if (error) return { error: toError(error.message) }
  refresh(orgId)
  return { ok: true }
}

/**
 * Link de un solo uso para que el miembro elija una contraseña nueva. No manda
 * mail (no depende del límite de envíos de Supabase Auth): el admin lo copia y
 * se lo pasa por WhatsApp. Nunca se guarda; en el registro queda solo que se
 * generó.
 */
export async function createRecoveryLink(_prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")

  const { data: email, error } = await supabase.rpc("operon_prepare_recovery", {
    p_org: orgId,
    p_user: field(formData, "user"),
  })
  if (error || typeof email !== "string") return { error: toError(error?.message) }

  const { data, error: linkError } = await createAdminClient().auth.admin.generateLink({
    type: "recovery",
    email,
  })
  const hashedToken = data?.properties?.hashed_token
  if (linkError || !hashedToken) return { error: "No se pudo generar el link. Probá de nuevo." }

  refresh(orgId)
  const params = new URLSearchParams({ token_hash: hashedToken, type: "recovery" })
  return { link: `${await siteUrl()}/actualizar-contrasena?${params}`, email }
}
