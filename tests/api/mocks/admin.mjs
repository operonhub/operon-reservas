/** Doble del cliente service_role de Supabase: tablas en memoria + RPC grabadas. */
import { state } from "./state.mjs"

function table(name) {
  const filters = []
  let op = "select", patch = null, single = false
  const run = () => {
    if (state.failOn === `${name}:${op}`) {
      return Promise.resolve({ data: null, error: { message: "db down", code: "XX000" } })
    }
    const rows = (state[name] ?? []).filter((r) => filters.every(([k, v, how]) => how === "in" ? v.includes(r[k]) : r[k] === v))
    if (op === "insert") {
      const row = { id: `${name}-${(state[name] ?? []).length + 1}`, created_at: new Date().toISOString(), mp_init_point: null, ...patch }
      state[name] = [...(state[name] ?? []), row]
      return Promise.resolve({ data: row, error: null })
    }
    if (op === "update") {
      rows.forEach((r) => Object.assign(r, patch))
      state.updates.push({ table: name, patch, rows: rows.length })
      return Promise.resolve({ data: null, error: null })
    }
    const sorted = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    return Promise.resolve({ data: single ? (sorted[0] ?? null) : sorted, error: null })
  }
  const builder = {
    select: () => builder,
    insert: (row) => { op = "insert"; patch = row; return builder },
    single: () => { single = true; return run() },
    update: (p) => { op = "update"; patch = p; return builder },
    eq: (k, v) => { filters.push([k, v, "eq"]); return builder },
    in: (k, v) => { filters.push([k, v, "in"]); return builder },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => { single = true; return run() },
    then: (ok, ko) => run().then(ok, ko),
  }
  return builder
}

export function createAdminClient() {
  return {
    from: (name) => table(name),
    rpc: async (fn, args) => {
      state.rpcCalls.push({ fn, args })
      if (state.rpcResults[fn]) return state.rpcResults[fn]
      const r = state.reservations.find((x) => x.id === args?.p_reservation)
      if (fn === "transition_reservation") {
        if (r) r.status = args.p_to
        return { data: args.p_to, error: null }
      }
      if (fn === "recover_paid_expired_reservation") {
        if (r) r.status = "confirmed"
        return { data: "RECOVERED", error: null }
      }
      return { data: null, error: null }
    },
  }
}
