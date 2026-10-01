/**
 * La web de un cliente y su widget de reservas (0038). Todo puro: se usa desde
 * la ficha de /operon y se prueba sin red.
 */

export type WebsiteStatus = "connected" | "link_only" | "mismatch" | "unconfigured" | "demo" | "not_found" | "unreachable"
export type Tone = "success" | "warning" | "danger" | "muted"

export const WEBSITE_STATUS: Record<WebsiteStatus, { label: string; tone: Tone; hint: string }> = {
  connected: { label: "Conectada", tone: "success", hint: "El widget está en la web y apunta a este complejo." },
  link_only: { label: "Solo un link", tone: "warning", hint: "La web lleva a su página de reservas, pero no tiene el widget integrado." },
  mismatch: { label: "Widget de otro complejo", tone: "danger", hint: "El widget está en la web pero apunta a otro complejo: las reservas caerían en otro panel." },
  unconfigured: { label: "Widget sin configurar", tone: "danger", hint: "Quedó el texto de ejemplo en ORG_SLUG: hay que poner el slug del complejo." },
  demo: { label: "Widget de demostración", tone: "danger", hint: "La web tiene la versión demo del widget (sin conexión, con cabañas de ejemplo): ninguna reserva llega al panel. Hay que reemplazarla por el código de acá abajo." },
  not_found: { label: "No detectada", tone: "warning", hint: "No encontramos el widget en esa página." },
  unreachable: { label: "No se pudo abrir", tone: "muted", hint: "No pudimos leer la página." },
}

export const WEBSITE_STATUSES = Object.keys(WEBSITE_STATUS) as WebsiteStatus[]

/** Dirección que se guarda: con https si falta, sin #ancla, solo http(s) con dominio. */
export function normalizeWebsiteUrl(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    if (url.username || url.password || !url.hostname.includes(".")) return null
    url.hash = ""
    const out = url.toString()
    return out.length <= 300 ? out : null
  } catch { return null }
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const PLACEHOLDER_SLUG = /^CAMBIAR/i

/**
 * Mira el HTML de la web y dice si el widget de ESTE complejo está puesto.
 * `note` trae lo que conviene saber (otro slug, dominio viejo, falta el WhatsApp).
 */
export function analyzeWidget(html: string, slug: string): { status: WebsiteStatus; note: string | null } {
  const config = html.match(/ORG_SLUG["']?\s*[:=]\s*["']([^"']*)["']/)
  if (config) {
    const found = config[1].trim()
    if (PLACEHOLDER_SLUG.test(found) || found === "") return { status: "unconfigured", note: null }
    if (found !== slug) return { status: "mismatch", note: `Apunta a «${found.slice(0, 80)}», no a «${slug}».` }
    const notes: string[] = []
    const app = html.match(/RESERVAS_APP["']?\s*[:=]\s*["']([^"']*)["']/)
    if (app && /\.vercel\.app/i.test(app[1])) notes.push("Usa la dirección vieja de Vercel (sigue andando); conviene cambiarla a www.operonreservas.com.")
    const wa = html.match(/WA_NUMBER["']?\s*[:=]\s*["']([^"']*)["']/)
    if (wa && (/X{3,}/i.test(wa[1]) || !/^\d{10,15}$/.test(wa[1]))) notes.push("Falta cargar el número de WhatsApp (WA_NUMBER).")
    return { status: "connected", note: notes.join(" ") || null }
  }
  // La versión de las demos de prospección: se ve igual, pero no tiene backend.
  if (/SHOW_EXAMPLE_PRICES|versi[oó]n DEMO/i.test(html)) return { status: "demo", note: null }
  const path = new RegExp(`/reservar/${escape(slug)}(?![a-z0-9-])`, "i")
  const frame = new RegExp(`<iframe[^>]+/reservar/${escape(slug)}(?![a-z0-9-])`, "i")
  if (frame.test(html)) {
    return { status: "link_only", note: "Usa un iframe: el pago con Mercado Pago no funciona dentro de un iframe." }
  }
  if (path.test(html)) return { status: "link_only", note: null }
  return { status: "not_found", note: null }
}

/** WhatsApp en el formato del widget (549 + área + número, sin +). null si no se puede deducir. */
export function normalizeWhatsapp(input: string | null | undefined): string | null {
  const digits = (input ?? "").replace(/\D/g, "")
  if (/^549\d{10}$/.test(digits)) return digits
  if (/^54(?!9)\d{10}$/.test(digits)) return "549" + digits.slice(2)
  if (/^\d{10}$/.test(digits) && !digits.startsWith("0")) return "549" + digits
  return null
}

/** El código para pegar en la web del cliente: la plantilla con su slug y su WhatsApp. */
export function buildSnippet(template: string, input: { slug: string; whatsapp: string | null | undefined }) {
  const whatsapp = normalizeWhatsapp(input.whatsapp)
  const slug = input.slug.replace(/[^a-z0-9-]/gi, "")
  let code = template.replace(/ORG_SLUG:\s*'[^']*',[^\n]*/, `ORG_SLUG:     '${slug}',`)
  code = code.replace(/WA_NUMBER:\s*'[^']*',[^\n]*/, whatsapp
    ? `WA_NUMBER:    '${whatsapp}',`
    : `WA_NUMBER:    '549XXXXXXXXXX',   // <<< completar: WhatsApp del complejo, sin + ni espacios`)
  return { code, whatsappOk: whatsapp !== null }
}
