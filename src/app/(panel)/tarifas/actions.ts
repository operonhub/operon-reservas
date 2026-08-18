"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireContext } from "@/lib/auth"
import { RULE_PRESETS, type RulePreset } from "@/lib/rate-rules"

export type ActionResult = { ok: boolean; error?: string }

function num(raw: FormDataEntryValue | null): number | null {
  const v = String(raw ?? "").trim()
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Traduce el preset elegido a las condiciones que guarda la base, quedándose
 * SÓLO con los campos que ese preset declara. Así un campo que el formulario
 * no mostró nunca llega con un valor colado.
 */
function parseForm(formData: FormData) {
  const presetRaw = String(formData.get("preset") ?? "base")
  const preset = (presetRaw in RULE_PRESETS ? presetRaw : "base") as RulePreset
  const def = RULE_PRESETS[preset]
  const has = (f: string) => def.fields.includes(f as never)

  const price = has("price") ? num(formData.get("price_per_night")) : null
  const discount = has("discount") ? num(formData.get("discount_pct")) : null

  const weekdaysRaw = has("weekdays")
    ? String(formData.get("weekdays") ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    : []
  const weekdays = weekdaysRaw.length ? [...new Set(weekdaysRaw)].sort() : null

  const start = has("dates") ? String(formData.get("start_date") ?? "").trim() || null : null
  const end = has("dates") ? String(formData.get("end_date") ?? "").trim() || null : null

  const priority = num(formData.get("priority")) ?? 0

  return {
    preset,
    kind: def.kind,
    unit_id: String(formData.get("unit_id") ?? "") || null, // "" = toda la propiedad
    label: String(formData.get("label") ?? "").trim() || def.label,
    price_per_night: price,
    // Una regla no puede fijar precio Y descuento a la vez: si vinieron los
    // dos (el preset "según huéspedes" ofrece ambos), gana el precio.
    discount_pct: price != null ? null : discount,
    weekdays,
    min_guests: has("guests") ? num(formData.get("min_guests")) : null,
    max_guests: has("guests") ? num(formData.get("max_guests")) : null,
    min_nights: has("minNights") ? Math.max(1, Math.floor(num(formData.get("min_nights")) ?? 1)) : 1,
    min_nights_rule: has("minNightsRule")
      ? (() => {
          const n = num(formData.get("min_nights_rule"))
          return n != null && n >= 2 ? Math.floor(n) : null
        })()
      : null,
    priority: [0, 10, 20].includes(priority) ? priority : 0,
    start_date: start,
    end_date: end,
    is_active: formData.get("is_active") !== "off",
  }
}

function validate(v: ReturnType<typeof parseForm>): string | null {
  const def = RULE_PRESETS[v.preset]

  if (v.kind === "base") {
    if (v.price_per_night == null || v.price_per_night <= 0)
      return "El precio base debe ser mayor a 0."
  } else if (v.price_per_night == null && v.discount_pct == null) {
    return "Definí un precio o un porcentaje de descuento."
  }

  if (v.price_per_night != null && v.price_per_night <= 0)
    return "El precio por noche debe ser mayor a 0."
  if (v.discount_pct != null && (v.discount_pct <= 0 || v.discount_pct > 100))
    return "El descuento debe estar entre 1 y 100."

  if (v.start_date || v.end_date) {
    if (!v.start_date || !v.end_date) return "Completá las dos fechas del período."
    if (v.end_date < v.start_date)
      return "La fecha de fin no puede ser anterior al inicio."
  }

  if (def.fields.includes("weekdays") && !v.weekdays?.length)
    return "Elegí al menos un día de la semana."

  if (v.min_guests != null && v.max_guests != null && v.min_guests > v.max_guests)
    return "El mínimo de huéspedes no puede ser mayor al máximo."

  if (def.fields.includes("minNightsRule") && v.min_nights_rule == null)
    return "Indicá a partir de cuántas noches aplica (mínimo 2)."

  return null
}

/** Campos que se escriben en la tabla (sin el preset, que es sólo de la UI). */
function toRow(v: ReturnType<typeof parseForm>) {
  return {
    unit_id: v.unit_id,
    kind: v.kind,
    label: v.label,
    price_per_night: v.price_per_night,
    discount_pct: v.discount_pct,
    weekdays: v.weekdays,
    min_guests: v.min_guests,
    max_guests: v.max_guests,
    min_nights: v.min_nights,
    min_nights_rule: v.min_nights_rule,
    priority: v.priority,
    start_date: v.start_date,
    end_date: v.end_date,
    is_active: v.is_active,
  }
}

export async function createRate(formData: FormData): Promise<ActionResult> {
  const ctx = await requireContext()
  const supabase = await createClient()

  const property_id = String(formData.get("property_id") ?? "")
  if (!property_id) return { ok: false, error: "Falta la propiedad." }

  const v = parseForm(formData)
  const err = validate(v)
  if (err) return { ok: false, error: err }

  const { error } = await supabase.from("rates").insert({
    organization_id: ctx.organizationId, // del membership, no del cliente
    property_id,
    ...toRow(v),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/tarifas")
  return { ok: true }
}

export async function updateRate(formData: FormData): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, error: "Falta el identificador." }

  const v = parseForm(formData)
  const err = validate(v)
  if (err) return { ok: false, error: err }

  const { error } = await supabase.from("rates").update(toRow(v)).eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/tarifas")
  return { ok: true }
}

/** Apagar una promo sin perder su configuración. */
export async function toggleRateActive(
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()
  const { error } = await supabase
    .from("rates")
    .update({ is_active: isActive })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/tarifas")
  return { ok: true }
}

export async function deleteRate(id: string): Promise<ActionResult> {
  await requireContext()
  const supabase = await createClient()
  const { error } = await supabase.from("rates").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/tarifas")
  return { ok: true }
}
