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
