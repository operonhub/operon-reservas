import { headers } from "next/headers"

/**
 * Origen del sitio para armar links absolutos (invitaciones, link público de
 * reservas). En producción conviene fijarlo con NEXT_PUBLIC_SITE_URL; si no
 * está, sale de las cabeceras del pedido. SOLO servidor.
 */
export async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/+$/, "")
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3040"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}
