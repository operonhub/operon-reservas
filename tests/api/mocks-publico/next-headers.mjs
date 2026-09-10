import { state } from "./state.mjs"
export async function headers() { return new Headers(state.headers) }
export async function cookies() { return { get: (name) => (name === "operon_demo" && state.demo ? { value: "1" } : undefined) } }
