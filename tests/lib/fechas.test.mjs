/**
 * M-04 y addDays: el src/lib/format.ts real (Node 24 importa TypeScript), con
 * el reloj congelado y el proceso en distintos husos horarios.
 */
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { todayISO, addDays, formatDayLong, checkOutFor, dateOrder, dateOrderHint } from "../../src/lib/format.ts"

const RealDate = Date
const originalTz = process.env.TZ
after(() => { globalThis.Date = RealDate; process.env.TZ = originalTz })
function freeze(iso) {
  const t = new RealDate(iso)
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(t.getTime()) }
    static now() { return t.getTime() }
  }
}
const ZONES = ["UTC", "America/Argentina/Cordoba", "Europe/Madrid", "Asia/Tokyo", "America/Los_Angeles"]

test("todayISO resuelve en el huso del alojamiento, sea cual sea el del servidor", () => {
  const cases = [
    ["2027-03-15T12:00:00Z", "2027-03-15"],
    ["2027-03-16T01:30:00Z", "2027-03-15"],   // 22:30 en Córdoba: UTC ya es el 16
    ["2027-03-16T02:59:00Z", "2027-03-15"],
    ["2027-03-16T03:00:00Z", "2027-03-16"],   // medianoche en Córdoba
  ]
  for (const [instant, expected] of cases) {
    for (const tz of ZONES) {
      process.env.TZ = tz
      freeze(instant)
      assert.equal(todayISO(), expected, `${instant} con el proceso en ${tz}`)
    }
  }
  globalThis.Date = RealDate
})

test("addDays no se corre un día en husos al este de UTC", () => {
  const cases = [["2026-09-10", 1, "2026-09-11"], ["2026-12-31", 1, "2027-01-01"], ["2027-03-01", -1, "2027-02-28"], ["2028-02-28", 1, "2028-02-29"]]
  for (const tz of ZONES) {
    process.env.TZ = tz
    for (const [iso, n, expected] of cases) assert.equal(addDays(iso, n), expected, `${iso} + ${n} en ${tz}`)
  }
})

test("la fecha en palabras es la misma en cualquier huso y no depende del idioma del equipo", () => {
  for (const tz of ZONES) {
    process.env.TZ = tz
    assert.equal(formatDayLong("2026-10-25"), "domingo, 25 de octubre de 2026", tz)
    assert.equal(formatDayLong("2026-02-05"), "jueves, 5 de febrero de 2026", tz)
    assert.equal(formatDayLong("2027-01-01"), "viernes, 1 de enero de 2027", tz)
  }
  // Vacío, a medio escribir o imposible: nada, en vez de una fecha equivocada.
  for (const bad of ["", null, undefined, "2026-10", "25/10/2026", "2026-02-30", "2026-13-01", "hola"]) {
    assert.equal(formatDayLong(bad), "", String(bad))
  }
})

test("al cambiar el ingreso, la salida se acomoda sola y conserva las noches", () => {
  // La salida sigue siendo posterior: no se toca.
  assert.equal(checkOutFor("2026-10-11", "2026-10-13", "2026-10-10"), "2026-10-13")
  // El ingreso pasó a la salida: se corre conservando las 3 noches que había.
  assert.equal(checkOutFor("2026-10-25", "2026-10-13", "2026-10-10"), "2026-10-28")
  // Ingreso el mismo día que la salida: tampoco vale.
  assert.equal(checkOutFor("2026-10-13", "2026-10-13", "2026-10-10"), "2026-10-16")
  // Sin estadía previa: una noche.
  assert.equal(checkOutFor("2026-10-25", "", ""), "2026-10-26")
  assert.equal(checkOutFor("2026-10-25", "2026-10-20", undefined), "2026-10-26")
  // Cruza de mes y de año sin correrse.
  assert.equal(checkOutFor("2026-12-31", "2026-10-13", "2026-10-10"), "2027-01-03")
  // Ingreso borrado: se deja la salida como estaba.
  assert.equal(checkOutFor("", "2026-10-13", "2026-10-10"), "2026-10-13")
})

test("se detecta el orden de fecha del equipo y solo se avisa si no es día/mes/año", () => {
  for (const locale of ["es-AR", "es", "es-ES", "pt-BR", "en-GB", "it-IT", "fr-FR", "de-DE"]) {
    assert.equal(dateOrder(locale), "dmy", locale)
  }
  // El caso de la clienta: un equipo en inglés de Estados Unidos.
  assert.equal(dateOrder("en-US"), "mdy")
  for (const locale of ["ja-JP", "zh-CN", "sv-SE", "hu-HU", "ko-KR"]) assert.equal(dateOrder(locale), "ymd", locale)
  // Un idioma que el navegador no reconoce no rompe nada.
  assert.equal(dateOrder("esto no es un idioma"), "dmy")

  assert.equal(dateOrderHint("dmy"), null)
  assert.match(dateOrderHint("mdy"), /mes \/ día \/ año/)
  assert.match(dateOrderHint("ymd"), /año \/ mes \/ día/)
})
