"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"
import { canManageSettings, SETTINGS_READ_ONLY_MESSAGE } from "@/lib/roles"
import { sanitizeAmenities } from "@/lib/amenities"
import { ICAL_URL_ERROR_MESSAGES, normalizeIcalUrl } from "@/lib/ical-url"
import { applyDemoUnitPatch } from "@/lib/demo/fixtures"
import { isDemoRequest, readDemoState, writeDemoState } from "@/lib/demo/session"

export type ActionResult = { ok: boolean; error?: string }

function parseCapacity(raw: FormDataEntryValue | null): number {
  const n = Number(raw ?? 1)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}

type IcalUrls =
  | { ok: true; airbnb_ical_url: string | null; booking_ical_url: string | null }
  | { ok: false; error: string }

/**
 * Los links de calendario se validan antes de guardarse: el worker los
 * descarga cada hora y antes aceptaba cualquier cosa, incluso direcciones
 * internas (auditoría B-03). webcal:// se guarda ya convertido a https://.
 */
function parseIcalUrls(formData: FormData): IcalUrls {
  const out = { airbnb_ical_url: null as string | null, booking_ical_url: null as string | null }
  const fields = [
    ["airbnb_ical_url", "Airbnb"],
    ["booking_ical_url", "Booking"],
  ] as const
  for (const [field, platform] of fields) {
    const raw = String(formData.get(field) ?? "").trim()
    if (!raw) continue
    const result = normalizeIcalUrl(raw)
    if (!result.ok) {
      return { ok: false, error: `El calendario de ${platform} ${ICAL_URL_ERROR_MESSAGES[result.reason]}` }
    }
    out[field] = result.url
  }
  return { ok: true, ...out }
}

/** Sólo claves del catálogo: lo que llega del form no se guarda a ciegas. */
function parseAmenities(raw: FormDataEntryValue | null): string[] {
  return sanitizeAmenities(String(raw ?? "").split(",").map((s) => s.trim()))
}

/**
 * La foto se sube desde el browser (las policies del bucket la acotan a la
 * org); acá sólo se valida que la ruta guardada empiece por la organización
 * del usuario, para que nadie apunte una unidad a la carpeta de otro tenant.
 */
function parsePhotoPath(
  raw: FormDataEntryValue | null,
  organizationId: string
): string | null {
  const path = String(raw ?? "").trim()
  if (!path) return null
  return path.startsWith(`${organizationId}/`) ? path : null
}

/** Verifica que la property pertenezca a la org del usuario (defensa en profundidad). */
async function assertProperty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string
) {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle() // RLS: solo devuelve si es de la org del usuario
  return !!data
}

export async function createUnit(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext()
  if (!canManageSettings(ctx.role)) return { ok: false, error: SETTINGS_READ_ONLY_MESSAGE }
  const supabase = await createClient()

  const property_id = String(formData.get("property_id") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim() || null
  const capacity = parseCapacity(formData.get("capacity"))

  if (!name) return { ok: false, error: "El nombre es obligatorio." }
  if (!property_id || !(await assertProperty(supabase, property_id)))
    return { ok: false, error: "Propiedad inválida." }

  const icalUrls = parseIcalUrls(formData)
  if (!icalUrls.ok) return { ok: false, error: icalUrls.error }

  const { error } = await supabase.from("units").insert({
    organization_id: ctx.organizationId, // derivado del membership, no del cliente
    property_id,
    name,
    description,
    capacity,
    photo_path: parsePhotoPath(formData.get("photo_path"), ctx.organizationId),
    amenities: parseAmenities(formData.get("amenities")),
    airbnb_ical_url: icalUrls.airbnb_ical_url,
    booking_ical_url: icalUrls.booking_ical_url,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/unidades")
  return { ok: true }
}

export async function updateUnit(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext()
  if (!canManageSettings(ctx.role)) return { ok: false, error: SETTINGS_READ_ONLY_MESSAGE }
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "")
  const name = String(formData.get("name") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim() || null
  const capacity = parseCapacity(formData.get("capacity"))
  const is_active = formData.get("is_active") === "on"

  if (!id) return { ok: false, error: "Falta el identificador." }
  if (!name) return { ok: false, error: "El nombre es obligatorio." }

  const icalUrls = parseIcalUrls(formData)
  if (!icalUrls.ok) return { ok: false, error: icalUrls.error }

  if (await isDemoRequest()) {
    const next = applyDemoUnitPatch(await readDemoState(), id, { name, description, capacity, is_active, amenities: parseAmenities(formData.get("amenities")) })
    if (!next) return { ok: false, error: "Unidad ficticia no encontrada." }
    await writeDemoState(next)
    revalidatePath("/unidades")
    revalidatePath("/calendario")
    return { ok: true }
  }

  // RLS acota el update a la org del usuario.
  const { error } = await supabase
    .from("units")
    .update({
      name,
      description,
      capacity,
      is_active,
      photo_path: parsePhotoPath(formData.get("photo_path"), ctx.organizationId),
      amenities: parseAmenities(formData.get("amenities")),
      airbnb_ical_url: icalUrls.airbnb_ical_url,
      booking_ical_url: icalUrls.booking_ical_url,
    })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/unidades")
  revalidatePath("/calendario")
  return { ok: true }
}

export async function toggleUnitActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  if (await isDemoRequest()) {
    const next = applyDemoUnitPatch(await readDemoState(), id, { is_active: isActive })
    if (!next) return { ok: false, error: "Unidad ficticia no encontrada." }
    await writeDemoState(next)
    revalidatePath("/unidades")
    revalidatePath("/calendario")
    return { ok: true }
  }
  const ctx = await requireContext()
  if (!canManageSettings(ctx.role)) return { ok: false, error: SETTINGS_READ_ONLY_MESSAGE }
  const supabase = await createClient()

  const { error } = await supabase
    .from("units")
    .update({ is_active: isActive })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/unidades")
  revalidatePath("/calendario")
  return { ok: true }
}
