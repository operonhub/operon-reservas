import type { createClient } from "@/lib/supabase/server"
import { deriveChecklist, type Checklist } from "./checklist"

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Lee lo que alimenta la lista de primeros pasos. Solo se llama mientras la
 * lista no fue ocultada: después Inicio no paga estas consultas.
 */
export async function loadChecklist(supabase: Client, organizationId: string): Promise<Checklist> {
  const [units, rates, property, reservations, mp, org] = await Promise.all([
    supabase.from("units").select("id").eq("is_active", true),
    supabase.from("rates").select("unit_id").eq("kind", "base").eq("is_active", true),
    supabase
      .from("properties")
      .select("deposit_pct")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("reservations").select("*", { count: "exact", head: true }),
    supabase.rpc("mp_connection_status"),
    supabase.from("organizations").select("link_shared_at").eq("id", organizationId).maybeSingle(),
  ])

  const unitIds = (units.data ?? []).map((unit) => unit.id)
  const baseRates = rates.data ?? []
  // Una tarifa base sin unidad aplica a todo el complejo.
  const coversAll = baseRates.some((rate) => rate.unit_id === null)
  const covered = new Set(baseRates.map((rate) => rate.unit_id))

  return deriveChecklist({
    units: unitIds.length,
    unitsWithBaseRate: coversAll ? unitIds.length : unitIds.filter((id) => covered.has(id)).length,
    depositPct: Number(property.data?.deposit_pct ?? 0),
    mpConnected: (mp.data as { connected?: boolean } | null)?.connected === true,
    linkShared: Boolean(org.data?.link_shared_at),
    reservations: reservations.count ?? 0,
  })
}
