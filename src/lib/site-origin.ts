/**
 * Dominio público del producto. Todo link absoluto que la app arma para
 * terceros (reservas, invitaciones, aviso de pago de Mercado Pago) sale de acá.
 */
export const CANONICAL_ORIGIN = "https://www.operonreservas.com"

/**
 * Origen configurado para el sitio, sin barra final, o null si no hay uno
 * usable. NUNCA devuelve un dominio técnico de Vercel (*.vercel.app): esos
 * redirigen al dominio propio y, escritos en un link, quedan feos y frágiles.
 * En producción, sin valor configurado (o con uno de Vercel), usa el propio.
 */
export function configuredOrigin(
  configured: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  vercelEnv: string | undefined = process.env.VERCEL_ENV
): string | null {
  const value = configured?.trim().replace(/\/+$/, "")
  if (value) {
    try {
      if (!new URL(value).hostname.endsWith(".vercel.app")) return value
    } catch {
      // Valor mal escrito: se trata como si no estuviera.
    }
  }
  return vercelEnv === "production" ? CANONICAL_ORIGIN : null
}

/** Rutas que consumen programas (avisos de pago, cron, calendarios): no se redirigen. */
const MACHINE_PATHS = ["/api/", "/ical/"]

/**
 * Si el pedido llegó por un dominio técnico de Vercel (*.vercel.app) en
 * producción, devuelve la URL equivalente en el dominio propio; si no, null.
 * Vercel no deja redirigir desde el panel el dominio que genera solo para
 * cada proyecto, así que se hace acá. Solo para páginas (GET/HEAD): los
 * clientes automáticos de /api y /ical siguen respondiendo donde los llaman.
 */
export function canonicalRedirect(
  url: URL,
  method: string,
  origin: string | null = configuredOrigin(),
  vercelEnv: string | undefined = process.env.VERCEL_ENV
): string | null {
  if (vercelEnv !== "production" || !origin) return null
  if (!url.hostname.endsWith(".vercel.app")) return null
  if (method !== "GET" && method !== "HEAD") return null
  if (MACHINE_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return null
  return `${origin}${url.pathname}${url.search}`
}
