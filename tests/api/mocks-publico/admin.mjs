import { state } from "./state.mjs"
export function createAdminClient() {
  return {
    rpc: async (fn, args) => {
      state.calls.push({ client: "service_role", fn, args })
      if (fn === "rate_limit_hit") return state.rpcError ? { data: null, error: state.rpcError } : { data: state.withinLimit, error: null }
      if (fn === "create_public_reservation") return { data: { ok: true, code: "R-ABC123", total_amount: 1 }, error: null }
      if (fn === "public_reservation_status") return { data: { code: "R-ABC123", status: "pending" }, error: null }
      return { data: null, error: null }
    },
  }
}
