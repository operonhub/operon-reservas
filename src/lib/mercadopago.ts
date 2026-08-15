/**
 * Helpers de Mercado Pago — OAuth por organización (marketplace).
 *
 * Operon registra UNA aplicación de MP (client_id/secret). Cada cabaña
 * autoriza esa aplicación sobre SU cuenta; el dinero va directo a la cabaña.
 * Operon nunca es intermediario ni retiene fondos.
 *
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/security/oauth
 */

const OAUTH_TOKEN_URL = "https://api.mercadopago.com/oauth/token"
// Dominio de autorización de Argentina.
const AUTH_BASE = "https://auth.mercadopago.com.ar/authorization"

export type MpTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
  user_id: number | string
  refresh_token: string
  public_key?: string
  live_mode?: boolean
}

function clientId(): string {
  const v = process.env.MP_CLIENT_ID
  if (!v) throw new Error("MP_CLIENT_ID no configurada")
  return v
}

function clientSecret(): string {
  const v = process.env.MP_CLIENT_SECRET
  if (!v) throw new Error("MP_CLIENT_SECRET no configurada")
  return v
}

/** URI de retorno del OAuth. Debe coincidir EXACTO con la registrada en MP. */
export function redirectUri(): string {
  const explicit = process.env.MP_REDIRECT_URI
  if (explicit) return explicit
  const site = process.env.NEXT_PUBLIC_SITE_URL
  if (!site) throw new Error("MP_REDIRECT_URI o NEXT_PUBLIC_SITE_URL no configuradas")
  return `${site.replace(/\/$/, "")}/api/mp/callback`
}

/** Está configurada la app de MP (client id/secret)? Para gatear la UI. */
export function isMercadoPagoConfigured(): boolean {
  return Boolean(process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET)
}

/** URL a la que redirigir al admin para autorizar la conexión (con PKCE). */
export function buildAuthorizeUrl(params: {
  state: string
  codeChallenge: string
}): string {
  const url = new URL(AUTH_BASE)
  url.searchParams.set("client_id", clientId())
  url.searchParams.set("response_type", "code")
  url.searchParams.set("platform_id", "mp")
  url.searchParams.set("state", params.state)
  url.searchParams.set("redirect_uri", redirectUri())
  url.searchParams.set("code_challenge", params.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

async function postToken(body: Record<string, string>): Promise<MpTokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as
    | MpTokenResponse
    | { message?: string; error?: string }
  if (!res.ok) {
    const msg =
      ("message" in data && data.message) ||
      ("error" in data && data.error) ||
      `HTTP ${res.status}`
    throw new Error(`MP_OAUTH_${res.status}: ${msg}`)
  }
  return data as MpTokenResponse
}

/** Intercambia el `code` del callback por tokens (flujo authorization_code + PKCE). */
export function exchangeCodeForToken(params: {
  code: string
  codeVerifier: string
}): Promise<MpTokenResponse> {
  return postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: redirectUri(),
    code_verifier: params.codeVerifier,
  })
}

/** Renueva un access_token vencido con el refresh_token. */
export function refreshAccessToken(refreshToken: string): Promise<MpTokenResponse> {
  return postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
}
