"use server"

import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { INTERESTS } from "@/lib/zone-month/content"
import { validDate } from "@/lib/zone-month/validation"

export type FeedbackResult = { ok: true } | { ok: false; error: string }

/**
 * Guarda lo que el dueño contesta en el informe: qué quiere profundizar y qué
 * ideas ya hizo. Cada parte se manda por separado y se combina con lo guardado.
 */
export async function saveZoneFeedback(month: string, patch: { interests?: string[]; toggle?: { id: string; done: boolean } }): Promise<FeedbackResult> {
  const ctx = await requireContext()
  if (!validDate(month) || !month.endsWith("-01")) return { ok: false, error: "Mes inválido." }
  const interests = patch.interests?.filter(i => Object.hasOwn(INTERESTS, i))
  if (patch.toggle && !/^[a-z0-9-]{1,40}$/.test(patch.toggle.id)) return { ok: false, error: "Idea inválida." }

  const supabase = await createClient()
  const { data: current } = await supabase.from("zone_month_feedback")
    .select("interests, done").eq("organization_id", ctx.organizationId).eq("month", month).maybeSingle()
  const { error } = await supabase.rpc("zone_month_save_feedback", {
    p_org: ctx.organizationId,
    p_month: month,
    p_interests: interests ?? current?.interests ?? [],
    // Un tilde a la vez, aplicado sobre lo guardado: dos ideas seguidas no se pisan.
    p_done: patch.toggle
      ? [...(current?.done ?? []).filter(d => d !== patch.toggle!.id), ...(patch.toggle.done ? [patch.toggle.id] : [])].slice(0, 20)
      : current?.done ?? [],
  })
  return error ? { ok: false, error: "No se pudo guardar. Probá de nuevo." } : { ok: true }
}
