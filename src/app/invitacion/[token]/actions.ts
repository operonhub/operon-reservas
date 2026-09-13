"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { TOKEN_RE, hashToken } from "@/lib/invitations"
import { RATE_LIMITED_MESSAGE, clientIp, withinLimit } from "@/lib/rate-limit"
import { DEMO_STATE_COOKIE } from "@/lib/demo/fixtures"

export type RegisterState = {
  error?: string
  fields?: { fullName: string; email: string }
} | null

type Lookup = { status: string; email: string | null; redeemed_by: string | null }
type Redeem = { ok: boolean; reason?: string }

const REASONS: Record<string, string> = {
  used: "Esta invitación ya se usó. Si fuiste vos, iniciá sesión con tu email.",
  expired: "Esta invitación venció. Escribinos y te mandamos una nueva.",
  revoked: "Esta invitación fue anulada. Escribinos y te mandamos una nueva.",
  not_found: "El link no es válido. Revisá que esté completo.",
  email_mismatch: "Esta invitación es para otro email.",
  already_member: "Esta cuenta ya tiene un complejo. Iniciá sesión para entrar a tu panel.",
  already_has_grant: "Esta cuenta ya tiene una configuración en curso.",
}
const GENERIC_ERROR = "No pudimos crear tu cuenta. Probá de nuevo en un momento."

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function registerWithInvitation(
  token: string,
  _prev: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const fullName = String(formData.get("full_name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  const password = String(formData.get("password") ?? "")
  const fields = { fullName, email }

  if (!TOKEN_RE.test(token)) return { error: REASONS.not_found, fields }
  if (fullName.length < 2) return { error: "Contanos tu nombre.", fields }
  if (!EMAIL_RE.test(email)) return { error: "Revisá el email.", fields }
  if (password.length < 8) return { error: "La contraseña tiene que tener al menos 8 caracteres.", fields }

  if (!(await withinLimit("invitacion", clientIp(await headers())))) {
    return { error: RATE_LIMITED_MESSAGE, fields }
  }

  const admin = createAdminClient()
  const tokenHash = hashToken(token)

  // Se chequea antes de crear el usuario, para no dejar cuentas huérfanas
  // por un link vencido o un email equivocado.
  const { data: lookupData } = await admin.rpc("invitation_lookup", { p_token_hash: tokenHash })
  const lookup = lookupData as Lookup | null
  if (!lookup || lookup.status !== "valid") return { error: REASONS[lookup?.status ?? "not_found"], fields }
  if (lookup.email && lookup.email !== email) return { error: REASONS.email_mismatch, fields }

  // Con email_confirm la cuenta queda activa sin mail de confirmación: la
  // invitación ya prueba que Operon conoce a esta persona.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createError || !created.user) {
    if (createError?.code === "email_exists" || /already.*registered/i.test(createError?.message ?? "")) {
      return { error: "Ya existe una cuenta con ese email. Iniciá sesión y volvé a abrir este link.", fields }
    }
    if (createError?.code === "weak_password") {
      return { error: "Elegí una contraseña más difícil de adivinar.", fields }
    }
    return { error: GENERIC_ERROR, fields }
  }

  const { data: redeemData } = await admin.rpc("invitation_redeem", {
    p_token_hash: tokenHash,
    p_user_id: created.user.id,
  })
  const redeemed = redeemData as Redeem | null
  if (!redeemed?.ok) {
    // Otro pedido la usó entre el chequeo y el canje: la cuenta recién creada
    // no sirve para nada, así que no se deja colgada.
    await admin.auth.admin.deleteUser(created.user.id)
    return { error: REASONS[redeemed?.reason ?? ""] ?? GENERIC_ERROR, fields }
  }

  const supabase = await createClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
  if (signInError) redirect("/login")
  redirect("/bienvenida")
}

export async function redeemForCurrentUser(token: string): Promise<{ error?: string }> {
  if (!TOKEN_RE.test(token)) return { error: REASONS.not_found }

  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (!userId) redirect(`/invitacion/${token}`)

  const { data: redeemData } = await createAdminClient().rpc("invitation_redeem", {
    p_token_hash: hashToken(token),
    p_user_id: userId,
  })
  const redeemed = redeemData as Redeem | null
  if (!redeemed?.ok) return { error: REASONS[redeemed?.reason ?? ""] ?? GENERIC_ERROR }
  redirect("/bienvenida")
}

/** Cierra la sesión actual (o sale de la demo) y vuelve al mismo link. */
export async function signOutAndContinue(token: string) {
  const jar = await cookies()
  if (jar.get("operon_demo")?.value === "1") {
    jar.delete("operon_demo")
    jar.delete(DEMO_STATE_COOKIE)
  } else {
    const supabase = await createClient()
    await supabase.auth.signOut()
  }
  redirect(TOKEN_RE.test(token) ? `/invitacion/${token}` : "/login")
}
