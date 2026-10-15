import { state } from "./state.mjs"
function chain(label) {
  const b = {}
  for (const m of ["select", "insert", "update", "delete", "eq", "in", "order", "limit"]) {
    b[m] = (...args) => {
      state.dbCalls.push(`${label}.${m}`)
      if (m === "insert" || m === "update") state.lastWrite = { table: label, op: m, values: args[0] }
      return b
    }
  }
  b.maybeSingle = async () => ({ data: { id: "x" }, error: null })
  b.then = (ok) => Promise.resolve({ data: null, error: null }).then(ok)
  return b
}
export async function createClient() {
  return {
    from: (t) => { state.dbCalls.push(`from:${t}`); return chain(t) },
    // Una prueba puede dejar en state.rpcResults la respuesta de una función; si no, devuelve vacío.
    rpc: async (fn, args) => {
      state.dbCalls.push(`rpc:${fn}`)
      state.lastRpc = { fn, args }
      return state.rpcResults?.[fn] ?? { data: null, error: null }
    },
  }
}
