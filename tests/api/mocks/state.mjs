/** Estado que comparten los dobles y cada test del webhook. */
const BASE = () => ({
  payments: [], reservations: [], rpcCalls: [], updates: [],
  cred: { access_token: "tok" }, credThrows: false,
  payment: null, mpThrows: null,
  failOn: null,            // "payments:select" | "payments:update" | "reservations:select"
  rpcResults: {},          // nombre de RPC -> { data, error }
})
export const state = BASE()
export function reset(patch = {}) {
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, BASE(), patch)
}
