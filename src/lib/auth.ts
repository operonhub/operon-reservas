import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

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
}

/**
 * Exige sesión + membership. Redirige a /login si no hay sesión,
 * o a /sin-acceso si el usuario no pertenece a ninguna organización.
 * (Etapa 1: se toma la primera membership. El switcher multi-org es futuro.)
 */
export async function requireContext(): Promise<ActiveContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: membership } = await supabase
    .from("memberships")
    .select("role, organization_id, organizations(name, slug)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  const org = membership?.organizations as
    | { name: string; slug: string }
    | { name: string; slug: string }[]
    | null
  const orgObj = Array.isArray(org) ? org[0] : org

  if (!membership || !orgObj) {
    redirect("/sin-acceso")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle()

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name || user.email || "Usuario",
    organizationId: membership.organization_id,
    organizationName: orgObj.name,
    organizationSlug: orgObj.slug,
    role: membership.role,
  }
}
