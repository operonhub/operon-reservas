// Ejecuta el handler real con fetch simulado: un evento que lanza al
// renderizarse no puede frenar al resto del batch (auditoría B-04).
import { assertEquals } from "jsr:@std/assert@1"

Deno.env.set("SUPABASE_URL", "https://proyecto.test")
Deno.env.set("SUPABASE_ANON_KEY", "anon")
Deno.env.set("RESEND_API_KEY", "re_test")
Deno.env.set("RESEND_FROM", "Operon <r@test>")

const event = (id: string, currency: string) => ({
  id, event_type: "reservation_status_guest", reservation_status: "confirmed",
  recipient_email: `${id}@huesped.test`, idempotency_key: `k-${id}`,
  payload: { reservation_code: "R-1", total_amount: 1000, deposit_amount: 500, currency, new_status: "confirmed" },
})

Deno.test("un evento inválido no frena el batch de emails", async () => {
  const sent: string[] = []
  const marked: Record<string, string> = {}
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url.endsWith("/rpc/claim_notification_batch")) {
      return Response.json([event("uno", "ARS"), event("venenoso", "PESOS"), event("tres", "ARS")])
    }
    if (url.includes("api.resend.com")) { sent.push(body.to[0]); return Response.json({ id: "msg" }) }
    if (url.endsWith("/rpc/complete_notification")) { marked[body.p_id] = "sent"; return Response.json(true) }
    if (url.endsWith("/rpc/fail_notification")) { marked[body.p_id] = "failed"; return Response.json(true) }
    return new Response("?", { status: 404 })
  }) as typeof fetch

  let handler: ((r: Request) => Promise<Response>) | undefined
  Object.defineProperty(Deno, "serve", { value: (h: typeof handler) => { handler = h }, configurable: true })
  const quiet = console.error
  console.error = () => {}
  try {
    await import("./index.ts")
    const res = await handler!(new Request("https://f.test", { method: "POST", headers: { "x-worker-token": "t" } }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { configured: true, claimed: 3, sent: 2, failed: 1, skipped: 0 })
    assertEquals(sent, ["uno@huesped.test", "tres@huesped.test"])
    assertEquals(marked, { uno: "sent", venenoso: "failed", tres: "sent" })
  } finally {
    globalThis.fetch = realFetch
    console.error = quiet
  }
})
