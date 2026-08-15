import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, MpCredential } from "@/lib/supabase/types"
import { refreshAccessToken } from "@/lib/mercadopago"

type Admin = SupabaseClient<Database>

/**
 * Devuelve la credencial de MP de una org con un access_token vigente.
 * Si está por vencer (< 2 días), la renueva con el refresh_token y persiste
 * los nuevos tokens. Sólo para el backend confiable (service_role).
 * Devuelve null si la org no conectó Mercado Pago.
 */
export async function getValidCredential(
  admin: Admin,
  organizationId: string
): Promise<MpCredential | null> {
  const { data } = await admin.rpc("mp_service_get_credential", {
    p_organization_id: organizationId,
  })
  const cred = data as MpCredential | null
  if (!cred) return null

  const expiresSoon =
    new Date(cred.expires_at).getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000
  if (!expiresSoon) return cred

  try {
    const refreshed = await refreshAccessToken(cred.refresh_token)
    await admin.rpc("mp_service_update_tokens", {
      p_organization_id: organizationId,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token,
      p_expires_in: refreshed.expires_in,
    })
    return {
      ...cred,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    }
  } catch {
    // Si el refresh falla, seguimos con el token actual (puede que aún sirva).
    return cred
  }
}
