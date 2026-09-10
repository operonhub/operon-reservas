/**
 * M-04 y addDays: el src/lib/format.ts real (Node 24 importa TypeScript), con
 * el reloj congelado y el proceso en distintos husos horarios.
 */
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { todayISO, addDays } from "../../src/lib/format.ts"

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
