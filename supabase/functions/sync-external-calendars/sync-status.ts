/**
 * Resultado de cada calendario, reducido a un código que se puede guardar y
 * mostrar en el panel de Operon (0035).
 *
 * Nunca el mensaje crudo: los links de exportación de Airbnb/Booking llevan un
 * token secreto, y un error de red de Deno ("error sending request for url
 * (https://...)") lo incluiría entero.
 */

const KNOWN = /^(HTTP_\d{3}|NOT_ICAL|BAD_URL_[A-Z_]{1,30}|REDIRECT_BLOCKED_[A-Z_]{1,30}|TOO_MANY_REDIRECTS|TIMEOUT)$/

export function errorCode(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "TIMEOUT"
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return KNOWN.test(message) ? message : "SYNC_FAILED"
}

export type SyncReport = { unit_id: string; source: "airbnb" | "booking"; ok: boolean; error: string | null }

export function toReport(
  results: { unit_id: string; source: "airbnb" | "booking"; ok: boolean; error?: string }[]
): SyncReport[] {
  return results.map((r) => ({
    unit_id: r.unit_id,
    source: r.source,
    ok: r.ok,
    error: r.ok ? null : errorCode(r.error ?? ""),
  }))
}
