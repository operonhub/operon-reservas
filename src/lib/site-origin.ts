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
