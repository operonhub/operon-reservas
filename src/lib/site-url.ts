import { headers } from "next/headers"
import { cookies } from "next/headers"
import { configuredOrigin } from "@/lib/site-origin"

/**
 * Origen del sitio para armar links absolutos (invitaciones, link público de
 * reservas). Sale de NEXT_PUBLIC_SITE_URL; en producción, sin ese valor o con
 * uno de Vercel, es el dominio propio (ver site-origin). Fuera de producción
 * sale de las cabeceras del pedido. SOLO servidor.
 */
export async function siteUrl(): Promise<string> {
  const configured = configuredOrigin()
  // La demo debe apuntar al origen que abrió el visitante. Así el link que
  // aparece en el panel sigue funcionando en cualquier puerto local y nunca
  // deriva hacia la URL configurada para producción.
  const isDemo = (await cookies()).get("operon_demo")?.value === "1"
  if (configured && !isDemo) return configured
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3040"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

/** URL pública de reservas. En demo agrega una marca local para que el link
 * siga funcionando si se abre en otra pestaña o navegador sin la cookie. */
export async function publicReservationUrl(slug: string): Promise<string> {
  const base = await siteUrl()
  const isDemo = (await cookies()).get("operon_demo")?.value === "1"
  return `${base}/reservar/${encodeURIComponent(slug)}${isDemo ? "?demo=1" : ""}`
}
