// Lo que se guarda del resultado de cada calendario: códigos, nunca el link.
import { assertEquals } from "jsr:@std/assert@1"
import { errorCode, toReport } from "./sync-status.ts"

Deno.test("errorCode: conserva los códigos conocidos", () => {
  for (const code of ["HTTP_404", "HTTP_503", "NOT_ICAL", "BAD_URL_NOT_HTTPS", "REDIRECT_BLOCKED_PRIVATE_HOST", "TOO_MANY_REDIRECTS"]) {
    assertEquals(errorCode(new Error(code)), code)
    assertEquals(errorCode(code), code)
  }
})

Deno.test("errorCode: el timeout de la descarga es TIMEOUT", () => {
  assertEquals(errorCode(new DOMException("Signal timed out.", "TimeoutError")), "TIMEOUT")
})

Deno.test("errorCode: cualquier otro mensaje se reduce, y nunca deja pasar el link", () => {
  const leaky = "error sending request for url (https://www.airbnb.com/calendar/ical/123.ics?s=SECRETO)"
  assertEquals(errorCode(new Error(leaky)), "SYNC_FAILED")
  assertEquals(errorCode(new Error("RPC_SYNC_UNIT_EXTERNAL_BLOCKS_500: detalle")), "SYNC_FAILED")
  assertEquals(errorCode(new Error("HTTP_404 https://x.test")), "SYNC_FAILED")
  assertEquals(errorCode(undefined), "SYNC_FAILED")
})

Deno.test("toReport: un código por calendario y null si anduvo", () => {
  const report = toReport([
    { unit_id: "u1", source: "airbnb", ok: true },
    { unit_id: "u1", source: "booking", ok: false, error: "HTTP_410" },
    { unit_id: "u2", source: "airbnb", ok: false, error: "fetch failed: https://secreto" },
  ])
  assertEquals(report, [
    { unit_id: "u1", source: "airbnb", ok: true, error: null },
    { unit_id: "u1", source: "booking", ok: false, error: "HTTP_410" },
    { unit_id: "u2", source: "airbnb", ok: false, error: "SYNC_FAILED" },
  ])
  assertEquals(JSON.stringify(report).includes("secreto"), false)
})
