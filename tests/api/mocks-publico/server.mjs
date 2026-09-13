import { state } from "./state.mjs"
export async function createClient() {
  return { rpc: async (fn, args) => { state.calls.push({ client: "anon", fn, args }); return { data: { ok: true, code: "DEMO" }, error: null } } }
}
