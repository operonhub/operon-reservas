import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { InvitationsAdmin, type InvitationRow } from "./invitations-admin"

export const metadata: Metadata = {
  title: "Invitaciones · Operon",
  robots: { index: false, follow: false },
}

// El layout de /operon ya exige ser platform admin; la RPC lo vuelve a exigir.
export default async function InvitacionesPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("invitation_list")
  if (error) notFound()
  return <InvitationsAdmin invitations={(data ?? []) as InvitationRow[]} />
}
