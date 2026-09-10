import { state } from "./state.mjs"
function chain(label) {
  const b = {}
  for (const m of ["select", "insert", "update", "delete", "eq", "in", "order", "limit"]) {
    b[m] = (...args) => { state.dbCalls.push(`${label}.${m}`); return b }
  }
  b.maybeSingle = async () => ({ data: { id: "x" }, error: null })
  b.then = (ok) => Promise.resolve({ data: null, error: null }).then(ok)
  return b
}
export async function createClient() {
  return {
    from: (t) => { state.dbCalls.push(`from:${t}`); return chain(t) },
    rpc: async (fn) => { state.dbCalls.push(`rpc:${fn}`); return { data: null, error: null } },
  }
}
