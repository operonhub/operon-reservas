import { NextResponse } from "next/server"
import crypto from "node:crypto"
import { createClient } from "@/lib/supabase/server"
import { buildAuthorizeUrl, isMercadoPagoConfigured } from "@/lib/mercadopago"

export const runtime = "nodejs"

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Inicia el OAuth de Mercado Pago para la organización del admin.
 * Genera state (CSRF) + verifier/challenge (PKCE), los guarda en la base
 * asociados a la org, y redirige al consentimiento de MP.
 */
export async function GET(request: Request) {
  const configUrl = new URL("/configuracion", request.url)

  if (!isMercadoPagoConfigured()) {
    configUrl.searchParams.set("mp", "not_configured")
    return NextResponse.redirect(configUrl)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  const state = base64url(crypto.randomBytes(24))
  const codeVerifier = base64url(crypto.randomBytes(48))
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  )

  const { error } = await supabase.rpc("mp_save_oauth_state", {
    p_state: state,
    p_code_verifier: codeVerifier,
  })
  if (error) {
    // FORBIDDEN (rol) / NO_MEMBERSHIP u otros → volver con aviso.
    configUrl.searchParams.set("mp", "error")
    return NextResponse.redirect(configUrl)
  }

  return NextResponse.redirect(buildAuthorizeUrl({ state, codeChallenge }))
}
