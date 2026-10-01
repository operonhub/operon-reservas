import "server-only"
import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * Lee una página pública para comprobar que el widget está puesto. La dirección
 * la carga un admin, pero igual el servidor no debe poder usarse para llegar a
 * la red interna: se rechazan direcciones privadas (IP o resueltas por DNS), se
 * revalida cada redirección, y de la página solo se devuelve un estado, nunca
 * su contenido.
 */

export type FetchFailure = "invalid" | "blocked" | "unreachable" | "not_html" | "too_many_redirects"
export type FetchResult = { ok: true; html: string; finalUrl: string } | { ok: false; reason: FetchFailure }

const MAX_BYTES = 2_000_000
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 8000

function ipv4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
}

/** Loopback, privadas, link-local, CGNAT, multicast y reservadas (IPv4 e IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return ipv4Private(ip)
  if (version !== 6) return true
  const text = ip.toLowerCase()
  const mapped = text.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return ipv4Private(mapped[1])
  const first = parseInt(text.split(":")[0] || "0", 16)
  return text === "::" || text === "::1" || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00
}

type Deps = {
  lookup?: (hostname: string) => Promise<{ address: string }[]>
  fetch?: typeof fetch
}

async function allowed(url: URL, lookup: NonNullable<Deps["lookup"]>) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) return false
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host)) return !isPrivateAddress(host)
  if (!host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) return false
  try {
    const addresses = await lookup(host)
    return addresses.length > 0 && addresses.every(a => !isPrivateAddress(a.address))
  } catch { return false }
}

export async function fetchPublicHtml(input: string, deps: Deps = {}): Promise<FetchResult> {
  const lookup = deps.lookup ?? ((hostname) => dnsLookup(hostname, { all: true }))
  const doFetch = deps.fetch ?? fetch
  let url: URL
  try { url = new URL(input) } catch { return { ok: false, reason: "invalid" } }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await allowed(url, lookup))) return { ok: false, reason: "blocked" }
    let response: Response
    try {
      response = await doFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "OperonReservasCheck/1.0 (+https://www.operonreservas.com)", Accept: "text/html" },
        cache: "no-store",
      })
    } catch { return { ok: false, reason: "unreachable" } }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) return { ok: false, reason: "unreachable" }
      try { url = new URL(location, url) } catch { return { ok: false, reason: "invalid" } }
      continue
    }
    if (!response.ok) return { ok: false, reason: "unreachable" }
    if (!/text\/html|application\/xhtml/i.test(response.headers.get("content-type") ?? "")) return { ok: false, reason: "not_html" }

    // Lectura con tope: una página gigante no debe agotar la memoria.
    const reader = response.body?.getReader()
    if (!reader) return { ok: false, reason: "unreachable" }
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        size += value.byteLength
      }
    } catch { return { ok: false, reason: "unreachable" } } finally { void reader.cancel().catch(() => {}) }
    // Un bloque entero puede pasarse del tope: se recorta lo que sobra.
    const body = Buffer.concat(chunks.map(c => Buffer.from(c))).subarray(0, MAX_BYTES)
    const html = new TextDecoder("utf-8", { fatal: false }).decode(body)
    return { ok: true, html, finalUrl: url.toString() }
  }
  return { ok: false, reason: "too_many_redirects" }
}
