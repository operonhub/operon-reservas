import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./types"

/**
 * Cliente Supabase con service_role. SOLO servidor: usa la clave secreta y
 * saltea RLS. Se emplea únicamente en endpoints de confianza que no tienen
 * sesión de usuario (webhook de Mercado Pago, creación de preferencias desde
 * la web pública). Nunca importar desde código que llegue al navegador.
 *
 * Sólo puede tocar `app_private` a través de las RPC `mp_service_*`, que
 * están concedidas exclusivamente a service_role.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada")
  }
  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
