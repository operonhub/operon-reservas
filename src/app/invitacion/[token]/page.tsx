import type { Metadata } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { TOKEN_RE, hashToken } from "@/lib/invitations"
import { InvitationScreen } from "./invitation-screen"

export const metadata: Metadata = {
  title: "Invitación · Operon Reservas",
  // El token viaja en la URL: que no se filtre en el Referer ni en buscadores.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

type Status = "valid" | "used" | "expired" | "revoked" | "not_found"
type Lookup = { status: Status; email: string | null; redeemed_by: string | null }

const INVALID: Record<Exclude<Status, "valid">, { title: string; message: string }> = {
  used: {
    title: "Esta invitación ya se usó",
    message: "Si la usaste vos, iniciá sesión con tu email y contraseña.",
  },
  expired: {
    title: "Esta invitación venció",
    message: "Los links duran 7 días. Escribinos y te mandamos uno nuevo.",
  },
  revoked: {
    title: "Esta invitación fue anulada",
    message: "Escribinos y te mandamos un link nuevo.",
  },
  not_found: {
    title: "El link no es válido",
    message: "Revisá que lo hayas copiado completo, o pedinos uno nuevo.",
  },
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!TOKEN_RE.test(token)) {
    return <InvitationScreen token="" view={{ kind: "invalid", ...INVALID.not_found }} />
  }

  // La demo usa un cliente ficticio sin Auth: primero hay que salir de ella.
  if ((await cookies()).get("operon_demo")?.value === "1") {
    return <InvitationScreen token={token} view={{ kind: "switch", currentEmail: null, isDemo: true }} />
  }

  const { data } = await createAdminClient().rpc("invitation_lookup", { p_token_hash: hashToken(token) })
  const invitation = (data ?? { status: "not_found", email: null, redeemed_by: null }) as Lookup

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  const userId = auth?.claims?.sub

  if (userId) {
    // Ya la canjeó (volvió al link, o refrescó): el asistente sigue donde quedó.
    if (invitation.redeemed_by === userId) redirect("/bienvenida")

    const [{ data: membership }, { data: onboarding }] = await Promise.all([
      supabase.from("memberships").select("id").limit(1).maybeSingle(),
      supabase.rpc("my_onboarding_status"),
    ])
    if ((onboarding as { has_grant?: boolean } | null)?.has_grant) redirect("/bienvenida")

    if (invitation.status === "valid") {
      const currentEmail = typeof auth?.claims?.email === "string" ? auth.claims.email : ""
      return (
        <InvitationScreen
          token={token}
          view={
            membership
              ? { kind: "switch", currentEmail, isDemo: false }
              : { kind: "claim", currentEmail }
          }
        />
      )
    }
  }

  if (invitation.status !== "valid") {
    return <InvitationScreen token={token} view={{ kind: "invalid", ...INVALID[invitation.status] }} />
  }
  return <InvitationScreen token={token} view={{ kind: "register", email: invitation.email }} />
}
