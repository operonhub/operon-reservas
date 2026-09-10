import { state } from "./state.mjs"
export async function getPayment() {
  if (state.mpThrows) throw new Error(state.mpThrows)
  return state.payment
}

export function siteUrl() { return "https://reservas.test" }
export async function createPreference(_token, body) {
  state.preferences = [...(state.preferences ?? []), body]
  return { id: "pref-1", init_point: "https://mp.test/init", sandbox_init_point: "https://mp.test/sandbox" }
}

export async function refreshAccessToken(refreshToken) {
  state.refreshCalls = [...(state.refreshCalls ?? []), refreshToken]
  if (state.refreshThrows) throw new Error("MP_OAUTH_400: invalid_grant")
  return { access_token: "tok-nuevo", refresh_token: "refresh-nuevo", expires_in: 15552000, token_type: "bearer", user_id: 1 }
}
