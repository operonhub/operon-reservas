import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { InvitationsAdmin, type InvitationRow } from "./invitations-admin"

export const metadata: Metadata = {
  title: "Invitaciones · Operon",
  robots: { index: false, follow: false },
}

/**
 * Página interna de Operon. A quien no es platform admin le responde 404 en
 * vez de "sin permiso", para no anunciar que existe.
 */
export default async function InvitacionesPage() {
  if ((await cookies()).get("operon_demo")?.value === "1") notFound()

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims?.sub) redirect("/login")

  const { data: isAdmin } = await supabase.rpc("is_platform_admin")
  if (!isAdmin) notFound()

  const { data } = await supabase.rpc("invitation_list")
  return <InvitationsAdmin invitations={(data ?? []) as InvitationRow[]} />
}
