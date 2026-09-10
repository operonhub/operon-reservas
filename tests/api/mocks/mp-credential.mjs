import { state } from "./state.mjs"
export async function getValidCredential() {
  if (state.credThrows) throw new Error("db down")
  return state.cred
}
