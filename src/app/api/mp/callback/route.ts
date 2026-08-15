import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { exchangeCodeForToken } from "@/lib/mercadopago"

export const runtime = "nodejs"

/**
 * Callback del OAuth de Mercado Pago. Valida el state (CSRF, ligado a la org),
 * intercambia el `code` por tokens (PKCE) y los persiste en `app_private` vía
 * RPC. El navegador nunca ve los tokens.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const configUrl = new URL("/configuracion", request.url)

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")

  if (oauthError) {
    configUrl.searchParams.set("mp", "denied")
    return NextResponse.redirect(configUrl)
  }
  if (!code || !state) {
    configUrl.searchParams.set("mp", "invalid_state")
    return NextResponse.redirect(configUrl)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Valida y consume el state (una sola vez), acotado a la org del admin.
  const { data: consumed, error: stateError } = await supabase.rpc(
    "mp_consume_oauth_state",
    { p_state: state }
  )
  const row = Array.isArray(consumed) ? consumed[0] : consumed
  if (stateError || !row) {
    configUrl.searchParams.set("mp", "invalid_state")
    return NextResponse.redirect(configUrl)
  }

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: row.code_verifier,
    })

    const { error: storeError } = await supabase.rpc("mp_store_credential", {
      p_organization_id: row.organization_id,
      p_mp_user_id: String(token.user_id),
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token,
      p_public_key: token.public_key ?? null,
      p_live_mode: Boolean(token.live_mode),
      p_scopes: token.scope ?? null,
      p_expires_in: token.expires_in,
    })
    if (storeError) throw new Error(storeError.message)

    configUrl.searchParams.set("mp", "connected")
    return NextResponse.redirect(configUrl)
  } catch {
    configUrl.searchParams.set("mp", "exchange_failed")
    return NextResponse.redirect(configUrl)
  }
}
