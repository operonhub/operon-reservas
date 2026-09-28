export const state = { calls: 0, fail: false }
export async function runZoneMonth() {
  state.calls++
  if (state.fail) throw new Error('sensitive-internal-detail')
  return {processed: 1, published: 1, failed: 0}
}
