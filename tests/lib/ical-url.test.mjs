/**
 * normalizeIcalUrl real (vive en supabase/functions/_shared, re-exportado por
 * src/lib/ical-url.ts). Auditoría B-03: qué links de calendario se aceptan.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeIcalUrl } from "../../src/lib/ical-url.ts"


const ok = (raw) => {
  const r = normalizeIcalUrl(raw)
  assert.equal(r.ok, true, `esperaba aceptar ${raw}: ${r.ok ? "" : r.reason}`)
  return r.url
}
const rejects = (raw, reason) => {
  const r = normalizeIcalUrl(raw)
  assert.equal(r.ok, false, `esperaba rechazar ${raw}`)
  if (reason) assert.equal(r.reason, reason)
}

test("acepta calendarios públicos de cualquier plataforma", () => {
  ok("https://www.airbnb.com/calendar/ical/12345.ics?s=abc")
  ok("https://admin.booking.com/hotel/hoteladmin/ical.html?t=xyz")
  ok("https://calendar.google.com/calendar/ical/x%40group.calendar.google.com/private-abc/basic.ics")
  ok("https://www.vrbo.com/icalendar/abcdef.ics")
})

test("convierte webcal:// a https://", () => {
  assert.equal(
    ok("webcal://www.airbnb.com/calendar/ical/9.ics"),
    "https://www.airbnb.com/calendar/ical/9.ics"
  )
})

test("rechaza lo que no es https", () => {
  rejects("http://www.airbnb.com/calendar/ical/9.ics", "NOT_HTTPS")
  rejects("ftp://host.com/x.ics", "NOT_HTTPS")
  rejects("file:///etc/passwd", "NOT_HTTPS")
  rejects("javascript:alert(1)", "NOT_HTTPS")
})

test("rechaza direcciones internas y metadata de la nube", () => {
  rejects("https://localhost/x.ics", "PRIVATE_HOST")
  rejects("https://metadata/x.ics", "PRIVATE_HOST")
  rejects("https://db.internal/x.ics", "PRIVATE_HOST")
  rejects("https://foo.local/x.ics", "PRIVATE_HOST")
  rejects("https://169.254.169.254/latest/meta-data/", "IP_ADDRESS")
  rejects("https://127.0.0.1/x.ics", "IP_ADDRESS")
  rejects("https://10.0.0.5/x.ics", "IP_ADDRESS")
  rejects("https://[::1]/x.ics", "IP_ADDRESS")
  // 2130706433 == 127.0.0.1, el parser de URL lo normaliza a IP.
  rejects("https://2130706433/x.ics", "IP_ADDRESS")
})

test("rechaza credenciales embebidas y puertos raros", () => {
  rejects("https://user:pass@www.airbnb.com/x.ics", "CREDENTIALS")
  rejects("https://www.airbnb.com:8080/x.ics", "PORT")
})

test("rechaza basura y strings enormes", () => {
  rejects("", "INVALID")
  rejects("no soy una url", "INVALID")
  rejects("https://host.com/" + "a".repeat(3000), "INVALID")
})
