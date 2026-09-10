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
  const { data, error } = await admin.rpc("mp_service_get_credential", {
    p_organization_id: organizationId,
  })
  // Un error de base no es "la org no conectó MP": quien llama tiene que
  // poder distinguirlo (el webhook reintenta en vez de descartar el pago).
  if (error) throw error
  const cred = data as MpCredential | null
  if (!cred) return null

  const expiresSoon =
    new Date(cred.expires_at).getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000
  if (!expiresSoon) return cred

  let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>
  try {
    refreshed = await refreshAccessToken(cred.refresh_token)
  } catch {
    // Si el refresh falla, seguimos con el token actual (puede que aún sirva).
    return cred
  }

  // Mercado Pago ya entregó un refresh_token nuevo y el viejo puede dejar de
  // servir: si el nuevo no queda guardado, cuando venza el access_token la
  // org queda desconectada de MP. Antes el error se descartaba sin rastro
  // (auditoría N-02); ahora se reintenta una vez y, si igual falla, queda
  // en el log para reconectar a mano. Este pedido sigue con el token nuevo.
  const save = () =>
    admin.rpc("mp_service_update_tokens", {
      p_organization_id: organizationId,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token,
      p_expires_in: refreshed.expires_in,
    })
  let { error: saveErr } = await save()
  if (saveErr) ({ error: saveErr } = await save())
  if (saveErr) {
    console.error(
      `Mercado Pago: se renovó el token de la organización ${organizationId} ` +
        `pero no se pudo guardar (${saveErr.message}). Si el anterior quedó ` +
        `invalidado, hay que reconectar Mercado Pago desde Configuración.`
    )
  }

  return {
    ...cred,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
  }
}
