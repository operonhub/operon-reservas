import { state } from "./state.mjs"
export async function requireContext() {
  return { userId: "u1", email: null, fullName: "X", organizationId: "org-a", organizationName: "A", organizationSlug: "a", role: state.role }
}
