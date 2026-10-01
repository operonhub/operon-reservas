"use server"

import { revalidatePath } from "next/cache"
import { operonClient, rpcErrorCode } from "@/lib/operon/client"
import { createAdminClient } from "@/lib/supabase/admin"
import { siteUrl } from "@/lib/site-url"
import { ERRORS as ZONE_ERRORS } from "@/lib/zone-month/content"
import { isZoneMonthEnabled } from "@/lib/zone-month/flag"
import { runZoneMonthEdition } from "@/lib/zone-month/worker"
import { fetchPublicHtml, type FetchFailure } from "@/lib/operon/safe-fetch"
import { analyzeWidget, normalizeWebsiteUrl, type WebsiteStatus } from "@/lib/operon/website"

/**
 * Acciones de la ficha de un cliente. Todas pasan por RPC con la sesión del
 * admin: la base verifica is_platform_admin() y deja el registro en la misma
 * transacción que el cambio. El service role aparece solo para generar el
 * link de contraseña, y DESPUÉS de que la RPC autorizó y registró.
 */

export type ActionState = { ok?: boolean; error?: string } | null
export type RecoveryState = { link?: string; email?: string; error?: string } | null

const MESSAGES: Record<string, string> = {
  FORBIDDEN: "No tenés permiso para hacer esto.",
  ORG_NOT_FOUND: "No encontramos el complejo.",
  REASON_REQUIRED: "Escribí el motivo (entre 3 y 500 caracteres).",
  REASON_TOO_LONG: "El motivo es demasiado largo.",
  ALREADY_SUSPENDED: "El complejo ya estaba suspendido.",
  NOT_SUSPENDED: "El complejo ya estaba activo.",
  NOT_A_MEMBER: "Esa persona ya no es parte del equipo.",
  LAST_OWNER: "Es el único dueño: no se puede quitar. Primero sumá o asigná otro dueño.",
  TARGET_IS_PLATFORM_ADMIN: "Es admin de Operon: su contraseña no se maneja desde acá.",
  NO_EMAIL: "Esa cuenta no tiene email.",
}

function toError(message: string | undefined) {
  const code = rpcErrorCode(message, Object.keys(MESSAGES))
  return code ? MESSAGES[code] : "No se pudo completar. Probá de nuevo."
}

function field(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function refresh(orgId: string) {
  revalidatePath(`/operon/clientes/${orgId}`)
  revalidatePath("/operon")
  revalidatePath("/operon/actividad")
}

export async function suspendOrg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const reason = field(formData, "reason")
  if (reason.length < 3) return { error: MESSAGES.REASON_REQUIRED }

  const { error } = await supabase.rpc("operon_suspend_org", { p_org: orgId, p_reason: reason })
  if (error) return { error: toError(error.message) }
  refresh(orgId)
  return { ok: true }
}

export async function reactivateOrg(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const reason = field(formData, "reason")

  const { error } = await supabase.rpc("operon_reactivate_org", {
    p_org: orgId,
    p_reason: reason || undefined,
  })
  if (error) return { error: toError(error.message) }
  refresh(orgId)
  return { ok: true }
}

export async function removeMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const reason = field(formData, "reason")
  if (reason.length < 3) return { error: MESSAGES.REASON_REQUIRED }

  const { error } = await supabase.rpc("operon_remove_member", {
    p_org: orgId,
    p_user: field(formData, "user"),
    p_reason: reason,
  })
  if (error) return { error: toError(error.message) }
  refresh(orgId)
  return { ok: true }
}

/**
 * Link de un solo uso para que el miembro elija una contraseña nueva. No manda
 * mail (no depende del límite de envíos de Supabase Auth): el admin lo copia y
 * se lo pasa por WhatsApp. Nunca se guarda; en el registro queda solo que se
 * generó.
 */
export async function createRecoveryLink(_prev: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")

  const { data: email, error } = await supabase.rpc("operon_prepare_recovery", {
    p_org: orgId,
    p_user: field(formData, "user"),
  })
  if (error || typeof email !== "string") return { error: toError(error?.message) }

  const { data, error: linkError } = await createAdminClient().auth.admin.generateLink({
    type: "recovery",
    email,
  })
  const hashedToken = data?.properties?.hashed_token
  if (linkError || !hashedToken) return { error: "No se pudo generar el link. Probá de nuevo." }

  refresh(orgId)
  const params = new URLSearchParams({ token_hash: hashedToken, type: "recovery" })
  return { link: `${await siteUrl()}/actualizar-contrasena?${params}`, email }
}

export type ZoneMonthState = { ok?: boolean; message?: string; error?: string } | null

const ZONE_MESSAGES: Record<string, string> = {
  ...MESSAGES,
  ORG_SUSPENDED: "El complejo está suspendido: reactivalo primero.",
  ZONE_CAP: "Ya hay 10 ciudades activas, que es el tope para cuidar la cuota de la IA. Desactivá otra primero.",
  ZONE_NOT_ENABLED: "Tu zona no está activada para este cliente.",
  ZONE_NOT_IN_ORG: "Esa ciudad ya no es la del complejo. Recargá la página.",
  MONTH_OUT_OF_RANGE: "Solo se puede generar el mes actual o el próximo.",
  ALREADY_PUBLISHED: "Esa edición ya está publicada.",
  ALREADY_RUNNING: "Esa edición se está generando ahora mismo.",
}

function toZoneError(message: string | undefined) {
  const code = rpcErrorCode(message, Object.keys(ZONE_MESSAGES))
  return code ? ZONE_MESSAGES[code] : "No se pudo completar. Probá de nuevo."
}

export async function setZoneMonth(_prev: ZoneMonthState, formData: FormData): Promise<ZoneMonthState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const enabled = field(formData, "enabled") === "1"

  const { error } = await supabase.rpc("operon_set_zone_month", { p_org: orgId, p_enabled: enabled })
  if (error) return { error: toZoneError(error.message) }
  refresh(orgId)
  return { ok: true, message: enabled ? "Tu zona quedó activada." : "Tu zona quedó desactivada." }
}

/**
 * "Generar ahora" / "Reintentar". Primero la RPC deja la edición pendiente
 * (verifica al admin y lo registra); después, si el interruptor general está
 * prendido, se genera en el momento con el mismo worker del cron.
 */
export async function generateZoneMonth(_prev: ZoneMonthState, formData: FormData): Promise<ZoneMonthState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const zone = field(formData, "zone")
  const month = field(formData, "month")

  const { error } = await supabase.rpc("operon_zone_month_queue", { p_org: orgId, p_zone: zone, p_month: month })
  if (error) return { error: toZoneError(error.message) }
  refresh(orgId)

  if (!isZoneMonthEnabled() || process.env.DEMO_ONLY === "1") {
    return {
      ok: true,
      message: "Quedó en cola. El interruptor general de Tu zona está apagado en Vercel: se genera cuando se prenda.",
    }
  }
  try {
    const result = await runZoneMonthEdition(zone, month)
    refresh(orgId)
    if (result.status === "published") return { ok: true, message: "Listo: la edición quedó publicada." }
    if (result.status === "busy") return { ok: true, message: "Ya se estaba generando. Recargá en un minuto." }
    return { error: `Volvió a fallar: ${ZONE_ERRORS[result.code ?? ""] ?? "error del proveedor de IA."}` }
  } catch {
    refresh(orgId)
    return { ok: true, message: "Quedó en cola: no se pudo generar ahora y lo reintenta el proceso automático." }
  }
}

// ---------- Web del cliente (0038) ----------

export type WebsiteState = { ok?: boolean; message?: string; error?: string } | null

const WEBSITE_MESSAGES: Record<string, string> = {
  ...MESSAGES,
  INVALID_URL: "Esa dirección no es válida. Probá con algo como https://sucomplejo.com.ar",
  NO_WEBSITE: "Primero cargá la dirección de la web.",
}

function toWebsiteError(message: string | undefined) {
  const code = rpcErrorCode(message, Object.keys(WEBSITE_MESSAGES))
  return code ? WEBSITE_MESSAGES[code] : "No se pudo completar. Probá de nuevo."
}

const FETCH_NOTES: Record<FetchFailure, string> = {
  invalid: "La dirección no es válida.",
  blocked: "Esa dirección no se puede leer desde el servidor.",
  unreachable: "La página no respondió o dio un error.",
  not_html: "La dirección no devuelve una página web.",
  too_many_redirects: "La dirección redirige demasiadas veces.",
}

/** Guarda (o borra, si va vacía) la dirección de la web donde está el widget. */
export async function saveWebsite(_prev: WebsiteState, formData: FormData): Promise<WebsiteState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")
  const raw = field(formData, "url")
  const url = raw === "" ? null : normalizeWebsiteUrl(raw)
  if (raw !== "" && !url) return { error: WEBSITE_MESSAGES.INVALID_URL }

  const { error } = await supabase.rpc("operon_set_website", { p_org: orgId, p_url: url })
  if (error) return { error: toWebsiteError(error.message) }
  refresh(orgId)
  return { ok: true, message: url ? "Web guardada. Verificala para ver si el widget está conectado." : "Se quitó la web." }
}

/**
 * Lee la página y busca el widget de ESTE complejo. Guarda solo el estado: el
 * contenido de la página no se conserva ni se devuelve.
 */
export async function verifyWebsite(_prev: WebsiteState, formData: FormData): Promise<WebsiteState> {
  const supabase = await operonClient()
  if (!supabase) return { error: "No disponible en la demo." }
  const orgId = field(formData, "org")

  const { data: org } = await supabase.from("organizations").select("slug, website_url").eq("id", orgId).maybeSingle()
  if (!org) return { error: WEBSITE_MESSAGES.ORG_NOT_FOUND }
  if (!org.website_url) return { error: WEBSITE_MESSAGES.NO_WEBSITE }

  const page = await fetchPublicHtml(org.website_url)
  const result: { status: WebsiteStatus; note: string | null } = page.ok
    ? analyzeWidget(page.html, org.slug)
    : { status: "unreachable", note: FETCH_NOTES[page.reason] }

  const { error } = await supabase.rpc("operon_record_website_check", { p_org: orgId, p_status: result.status, p_note: result.note })
  if (error) return { error: toWebsiteError(error.message) }
  refresh(orgId)
  return result.status === "connected"
    ? { ok: true, message: "Listo: el widget está conectado a este complejo." }
    : { ok: true, message: "Verificada. Mirá el estado y la nota debajo." }
}
