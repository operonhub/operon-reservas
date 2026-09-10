import { state } from "./state.mjs"
export function clientIp() { return "203.0.113.7" }
export async function withinLimit() { return state.withinLimit ?? true }
