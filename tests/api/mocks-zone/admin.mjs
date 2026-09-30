export const state = { jobs: [], calls: [], failMaterial: false, failFinish: false, editionRow: null, place: null, interests: {} }
export function createAdminClient() {
  return {
    rpc: async (fn, args) => {
      state.calls.push({fn,args})
      if (fn === 'zone_month_claim_enabled' || fn === 'zone_month_claim_edition') return {data: state.jobs.shift() || null, error: null}
      if (fn === 'zone_month_material') return {data: !state.failMaterial, error: null}
      if (fn === 'zone_month_finish') return {data: !state.failFinish, error: null}
      if (fn === 'zone_month_interests') return {data: state.interests, error: null}
      throw new Error('unexpected RPC')
    },
    // properties: provincia y departamento de la zona; zone_month_editions: código de error final.
    from: (table) => {
      const rows = table === 'properties' ? (state.place ? [state.place] : []) : null
      const query = {
        select: () => query, eq: () => query, ilike: () => query, order: () => query,
        limit: async () => ({data: rows, error: null}),
        maybeSingle: async () => ({data: state.editionRow, error: null}),
      }
      return query
    },
  }
}
