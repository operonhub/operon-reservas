export const state = { jobs: [], calls: [], failMaterial: false, failFinish: false }
export function createAdminClient() {
  return { rpc: async (fn, args) => {
    state.calls.push({fn,args})
    if (fn === 'zone_month_claim') return {data: state.jobs.shift() || null, error: null}
    if (fn === 'zone_month_material') return {data: !state.failMaterial, error: null}
    if (fn === 'zone_month_finish') return {data: !state.failFinish, error: null}
    throw new Error('unexpected RPC')
  }}
}
