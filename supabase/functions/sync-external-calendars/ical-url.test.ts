// La descarga sigue las redirecciones a mano y re-valida cada salto: un 302
// hacia una dirección interna se bloquea (auditoría B-03).
import { assertEquals, assertRejects } from "jsr:@std/assert@1"
import { normalizeIcalUrl } from "../_shared/ical-url.ts"

Deno.test("normalizeIcalUrl: acepta público, rechaza interno", () => {
  assertEquals(normalizeIcalUrl("webcal://airbnb.com/c.ics").ok, true)
  assertEquals(normalizeIcalUrl("https://169.254.169.254/x").ok, false)
})

// Reimplementa el mismo lazo que fetchIcal, con fetch simulado, para no
// exportar internals de index.ts (que arranca Deno.serve al importarse).
async function fetchIcal(startUrl: string, responder: (url: string) => Response): Promise<Response> {
  let current = startUrl
  for (let hop = 0; hop < 4; hop++) {
    const res = responder(current)
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get("location")
    if (!location) return res
    const next = normalizeIcalUrl(new URL(location, current).toString())
    if (!next.ok) throw new Error(`REDIRECT_BLOCKED_${next.reason}`)
    current = next.url
  }
  throw new Error("TOO_MANY_REDIRECTS")
}

Deno.test("sigue hasta 3 redirecciones válidas", async () => {
  const chain: Record<string, Response> = {
    "https://a.com/c.ics": new Response(null, { status: 302, headers: { location: "https://b.com/c.ics" } }),
    "https://b.com/c.ics": new Response(null, { status: 302, headers: { location: "https://c.com/c.ics" } }),
    "https://c.com/c.ics": new Response("BEGIN:VCALENDAR", { status: 200 }),
  }
  const res = await fetchIcal("https://a.com/c.ics", (u) => chain[u])
  assertEquals(await res.text(), "BEGIN:VCALENDAR")
})

Deno.test("una redirección a una dirección interna se bloquea", async () => {
  const responder = (u: string) =>
    u === "https://a.com/c.ics"
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
      : new Response("no debería llegar", { status: 200 })
  await assertRejects(() => fetchIcal("https://a.com/c.ics", responder), Error, "REDIRECT_BLOCKED")
})

Deno.test("un bucle de redirecciones corta", async () => {
  const loop = (u: string) =>
    new Response(null, { status: 302, headers: { location: u === "https://a.com/1" ? "https://a.com/2" : "https://a.com/1" } })
  await assertRejects(() => fetchIcal("https://a.com/1", loop), Error, "TOO_MANY_REDIRECTS")
})
