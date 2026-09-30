import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"

/**
 * Cliente de Supabase para las acciones del panel interno. Usa la sesión del
 * admin (no service role): cada RPC verifica is_platform_admin() y registra la
 * acción. En la demo no hay Auth real, así que devuelve null.
 */
export async function operonClient() {
  if ((await cookies()).get("operon_demo")?.value === "1") return null
  return createClient()
}

/** Los errores de las RPC llegan como `ERROR_CODE` dentro del mensaje. */
export function rpcErrorCode(message: string | undefined, codes: readonly string[]) {
  return codes.find((code) => message?.includes(code)) ?? null
}
