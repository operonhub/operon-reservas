"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { isValidSlug } from "@/lib/slug"
import {
  LAST_STEP,
  normalizeDraft,
  stepError,
  toSetupPayload,
  type SetupDraft,
} from "@/lib/onboarding/setup-draft"

async function setupClient() {
  if ((await cookies()).get("operon_demo")?.value === "1") redirect("/")
  return createClient()
}

export async function saveDraft(draft: SetupDraft): Promise<{ ok: boolean }> {
  const supabase = await setupClient()
  const { error } = await supabase.rpc("setup_save_draft", { p_draft: normalizeDraft(draft) })
  return { ok: !error }
}

/** available: null si no se pudo consultar (se decide al final, en la base). */
export async function checkSlug(slug: string): Promise<{ available: boolean | null }> {
  if (!isValidSlug(slug)) return { available: false }
  const supabase = await setupClient()
  const { data, error } = await supabase.rpc("setup_slug_available", { p_slug: slug })
  return { available: error ? null : data === true }
}

// Más específicos primero: "INVALID_UNIT" también está dentro de "INVALID_UNIT_NAME".
const SETUP_ERRORS: [code: string, message: string, step: number][] = [
  ["SLUG_TAKEN", "Ese link lo acaba de tomar otro complejo. Elegí otro.", 1],
  ["INVALID_SLUG", "Revisá tu link de reservas.", 1],
  ["INVALID_NAME", "Revisá el nombre del complejo.", 0],
  ["INVALID_CURRENCY", "Elegí una moneda.", 2],
  ["INVALID_TIME", "Revisá los horarios de check-in y check-out.", 2],
  ["INVALID_CITY", "Revisá la ciudad.", 2],
  ["DUPLICATE_UNIT_NAME", "Hay dos unidades con el mismo nombre.", 3],
  ["INVALID_CAPACITY", "Revisá cuántas personas entran en cada unidad.", 3],
  ["INVALID_UNIT_NAME", "Revisá los nombres de las unidades.", 3],
  ["INVALID_UNITS", "Revisá las unidades.", 3],
  ["INVALID_UNIT", "Revisá las unidades.", 3],
  ["INVALID_PRICE", "Revisá los precios por noche.", 4],
]

export async function finishSetup(raw: SetupDraft): Promise<{ error: string; step?: number }> {
  const draft = normalizeDraft(raw)
  for (let step = 0; step < LAST_STEP; step++) {
    const message = stepError(step, draft)
    if (message) return { error: message, step }
  }

  const supabase = await setupClient()
  const { error } = await supabase.rpc("complete_setup", { p_payload: toSetupPayload(draft) })
  if (error) {
    // Ya tiene complejo (doble click, otra pestaña): el panel es su lugar.
    if (/NO_GRANT|ALREADY_MEMBER/.test(error.message)) redirect("/")
    const known = SETUP_ERRORS.find(([code]) => error.message.includes(code))
    if (known) return { error: known[1], step: known[2] }
    return { error: "No pudimos crear tu complejo. Probá de nuevo en un momento." }
  }

  redirect("/?bienvenida=1")
}
