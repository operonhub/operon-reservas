import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { DEMO_CONTEXT } from "@/lib/demo/fixtures"

/**
 * Contexto activo del usuario del panel.
 * El organization_id se DERIVA de memberships en la base (RLS), nunca del cliente.
 */
export type ActiveContext = {
  userId: string
  email: string | null
  fullName: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  role: string
  /** Terminó (o salteó) el tour guiado del panel. */
  tourCompleted: boolean
  /** Alguien del equipo ocultó la lista de primeros pasos de Inicio. */
  checklistDismissed: boolean
}

/**
 * Exige sesión + membership. Redirige a /login si no hay sesión,
 * o a /sin-acceso si el usuario no pertenece a ninguna organización.
 * (Etapa 1: se toma la primera membership. El switcher multi-org es futuro.)
 *
 * Rendimiento — esta función corre en CADA navegación del panel, así que su
 * costo es el piso de latencia de todo el producto. Tres decisiones lo bajaron
 * de ~585 ms a ~180 ms:
 *
 * 1. `cache()` de React memoriza el resultado por request: el layout y la
 *    página lo piden por separado y se resuelve una sola vez.
 * 2. `getClaims()` en lugar de `getUser()`. `getUser()` es SIEMPRE un viaje de
 *    red al servidor de Auth (~230 ms). El proyecto firma con claves
 *    asimétricas (ES256), así que `getClaims()` baja el JWKS una vez por
 *    proceso y después verifica la firma localmente con WebCrypto, sin red.
 * 3. memberships y profiles van en paralelo: son independientes y no hay FK
 *    entre ellas, así que PostgREST no puede embeberlas en una sola consulta.
 *
 * Nota de seguridad: verificar la firma localmente es criptográficamente
 * sólido, pero no consulta al servidor de Auth por revocación. Un token
 * revocado sigue siendo válido hasta que expira (1 hora). Es el trade-off que
 * Supabase documenta como recomendado, y para una herramienta de gestión del
 * propietario es aceptable. Las mutaciones siguen protegidas por RLS.
 */
export const requireContext = cache(async function requireContext(): Promise<ActiveContext> {
  if ((await cookies()).get("operon_demo")?.value === "1") {
    return DEMO_CONTEXT
  }
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) redirect("/login")

  const userId = claims.sub
  const email = typeof claims.email === "string" ? claims.email : null

  // El estado del tour y de la lista de primeros pasos viaja en estas mismas
  // dos consultas: el onboarding no le suma viajes a la navegación normal.
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, organization_id, organizations(name, slug, checklist_dismissed_at)")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, tour_completed_at").eq("id", userId).maybeSingle(),
  ])

  type Org = { name: string; slug: string; checklist_dismissed_at: string | null }
  const org = membership?.organizations as Org | Org[] | null
  const orgObj = Array.isArray(org) ? org[0] : org

  if (!membership || !orgObj) {
    // Sin organización: si canjeó una invitación, le falta el asistente. Este
    // viaje extra solo lo paga quien todavía no tiene complejo.
    const { data: onboarding } = await supabase.rpc("my_onboarding_status")
    redirect((onboarding as { has_grant?: boolean } | null)?.has_grant ? "/bienvenida" : "/sin-acceso")
  }

  return {
    userId,
    email,
    fullName: profile?.full_name || email || "Usuario",
    organizationId: membership.organization_id,
    organizationName: orgObj.name,
    organizationSlug: orgObj.slug,
    role: membership.role,
    tourCompleted: Boolean(profile?.tour_completed_at),
    checklistDismissed: Boolean(orgObj.checklist_dismissed_at),
  }
})
