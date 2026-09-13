export const state = { withinLimit: true, rpcError: null, calls: [], headers: {}, demo: false }
export function reset(patch = {}) {
  Object.assign(state, { withinLimit: true, rpcError: null, calls: [], headers: { "x-real-ip": "203.0.113.7" }, demo: false }, patch)
}
