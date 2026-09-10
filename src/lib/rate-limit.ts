import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * Límite de intentos en lo público (auditoría A-03, migración 0025).
 *
 * El contador vive en Postgres. Las RPC públicas limitan por su cuenta a
 * quien las llama directo, por la IP que pone Cloudflare; pero los pedidos
 * de esta app salen todos de la IP de Vercel, así que acá se limita antes,
 * por la IP real del huésped, y la RPC se llama como service_role (exenta).
 */
export const LIMITS = {
  reservaPublica: { bucket: "reserva_publica", limit: 10, windowSeconds: 3600 },
  // /pago consulta cada 2,5 s durante un minuto: 24 veces por visita.
  estadoReserva: { bucket: "estado_reserva", limit: 120, windowSeconds: 600 },
  checkout: { bucket: "checkout", limit: 20, windowSeconds: 3600 },
} as const

export const RATE_LIMITED_MESSAGE =
  "Hubo demasiados intentos seguidos desde tu conexión. Esperá unos minutos y probá de nuevo."

/** IP del cliente según Vercel, que pisa estas cabeceras en su borde. */
export function clientIp(headers: Headers): string | null {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
}

function hasServiceRole(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Cuenta un intento y dice si sigue dentro del límite. Si el contador no
 * responde (o la 0025 todavía no está aplicada), deja pasar: una falla del
 * límite no puede frenar una reserva legítima.
 */
export async function withinLimit(kind: keyof typeof LIMITS, ip: string | null): Promise<boolean> {
  if (!ip || !hasServiceRole()) return true
  const { bucket, limit, windowSeconds } = LIMITS[kind]
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_subject: ip,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) return true
  return data !== false
}

/**
 * Cliente para las RPC públicas: service_role si está configurado (así la
 * RPC no cuenta todos los pedidos de Vercel como si fueran una sola IP), y
 * si no, el anónimo de siempre. Con la cookie de demo sigue siendo el
 * cliente ficticio: la demo nunca crea reservas reales.
 */
export async function publicRpcClient() {
  const isDemo = (await cookies()).get("operon_demo")?.value === "1"
  return hasServiceRole() && !isDemo ? createAdminClient() : await createClient()
}
