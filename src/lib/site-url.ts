import { headers } from "next/headers"
import { cookies } from "next/headers"

/**
 * Origen del sitio para armar links absolutos (invitaciones, link público de
 * reservas). En producción conviene fijarlo con NEXT_PUBLIC_SITE_URL; si no
 * está, sale de las cabeceras del pedido. SOLO servidor.
 */
export async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  // La demo debe apuntar al origen que abrió el visitante. Así el link que
  // aparece en el panel sigue funcionando en cualquier puerto local y nunca
  // deriva hacia la URL configurada para producción.
  const isDemo = (await cookies()).get("operon_demo")?.value === "1"
  if (configured && !isDemo) return configured.replace(/\/+$/, "")
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
