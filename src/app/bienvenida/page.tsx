import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { siteUrl } from "@/lib/site-url"
import { normalizeDraft } from "@/lib/onboarding/setup-draft"
import { SetupWizard } from "@/components/onboarding/wizard/setup-wizard"

export const metadata: Metadata = {
  title: "Configurá tu complejo · Operon Reservas",
  robots: { index: false, follow: false },
}

export default async function BienvenidaPage() {
  if ((await cookies()).get("operon_demo")?.value === "1") redirect("/")

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  const userId = auth?.claims?.sub
  if (!userId) redirect("/login")

  const [{ data: membership }, { data: onboarding }, { data: profile }] = await Promise.all([
    supabase.from("memberships").select("id").limit(1).maybeSingle(),
    supabase.rpc("my_onboarding_status"),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ])
  if (membership) redirect("/")

  const status = onboarding as { has_grant?: boolean; draft?: unknown } | null
  if (!status?.has_grant) redirect("/sin-acceso")

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? ""

  return (
    <SetupWizard
      initialDraft={normalizeDraft(status.draft)}
      firstName={firstName}
      publicBase={await siteUrl()}
    />
  )
}
