export const state = { jobs: [], calls: [], failMaterial: false, failFinish: false, editionRow: null }
export function createAdminClient() {
  return {
    rpc: async (fn, args) => {
      state.calls.push({fn,args})
      if (fn === 'zone_month_claim_enabled' || fn === 'zone_month_claim_edition') return {data: state.jobs.shift() || null, error: null}
      if (fn === 'zone_month_material') return {data: !state.failMaterial, error: null}
      if (fn === 'zone_month_finish') return {data: !state.failFinish, error: null}
      throw new Error('unexpected RPC')
    },
    // Solo lo usa runZoneMonthEdition para leer el código de error final.
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({data: state.editionRow, error: null}) }
      return query
    },
  }
}
