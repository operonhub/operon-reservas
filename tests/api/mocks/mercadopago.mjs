import { state } from "./state.mjs"
export async function getPayment() {
  if (state.mpThrows) throw new Error(state.mpThrows)
  return state.payment
}
