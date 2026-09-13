/**
 * Las server actions de tarifas, unidades y configuración (código real, vía
 * jiti) con la sesión y Supabase simulados: a 'staff' le devuelven el aviso
 * de solo lectura sin llegar a la base; a owner/admin los dejan pasar.
 */
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { state } from "./mocks-panel/state.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("./mocks-panel/", import.meta.url))
const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/auth": mocks + "auth.mjs",
    "@/lib/supabase/server": mocks + "supabase-server.mjs",
    "next/cache": mocks + "next-cache.mjs",
    "next/headers": mocks + "next-headers.mjs",
    "@/": root + "src/",
  },
  moduleCache: false,
})
const tarifas = await jiti.import(root + "src/app/(panel)/tarifas/actions.ts")
const unidades = await jiti.import(root + "src/app/(panel)/unidades/actions.ts")
const config = await jiti.import(root + "src/app/(panel)/configuracion/actions.ts")
const { SETTINGS_READ_ONLY_MESSAGE } = await jiti.import(root + "src/lib/roles.ts")

const form = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f }
const rateForm = form({ id: "r1", property_id: "p1", preset: "base", price_per_night: "1000", min_nights: "1" })
const unitForm = form({ id: "u1", property_id: "p1", name: "Cabaña", capacity: "2" })
const propForm = form({ id: "p1", name: "Refugio", currency: "ARS", deposit_pct: "30" })

const actions = [
  ["createRate", () => tarifas.createRate(rateForm)],
  ["updateRate", () => tarifas.updateRate(rateForm)],
  ["toggleRateActive", () => tarifas.toggleRateActive("r1", false)],
  ["deleteRate", () => tarifas.deleteRate("r1")],
  ["createUnit", () => unidades.createUnit(unitForm)],
  ["updateUnit", () => unidades.updateUnit(unitForm)],
  ["toggleUnitActive", () => unidades.toggleUnitActive("u1", false)],
  ["updateProperty", () => config.updateProperty(propForm)],
  ["disconnectMercadoPago", () => config.disconnectMercadoPago()],
]

beforeEach(() => { state.dbCalls = [] })

test("staff recibe el aviso de solo lectura y ninguna acción toca la base", async () => {
  state.role = "staff"
  for (const [name, run] of actions) {
    state.dbCalls = []
    assert.deepEqual(await run(), { ok: false, error: SETTINGS_READ_ONLY_MESSAGE }, name)
    assert.deepEqual(state.dbCalls, [], `${name} no debería consultar la base`)
  }
})

test("owner y admin pasan la guarda y llegan a la base", async () => {
  for (const role of ["owner", "admin"]) {
    state.role = role
    for (const [name, run] of actions) {
      state.dbCalls = []
      const res = await run()
      assert.notEqual(res.error, SETTINGS_READ_ONLY_MESSAGE, `${role} en ${name}`)
      assert.ok(state.dbCalls.length > 0, `${role} en ${name} debería llegar a la base`)
    }
  }
})

test("B-03: un link de calendario interno se rechaza antes de tocar la base", async () => {
  state.role = "owner"
  state.dbCalls = []
  const res = await unidades.updateUnit(
    form({ id: "u1", name: "Cabaña", capacity: "2", airbnb_ical_url: "https://169.254.169.254/x" })
  )
  assert.equal(res.ok, false)
  assert.match(res.error, /Airbnb/)
  assert.deepEqual(state.dbCalls, [])
})

test("B-03: webcal:// se guarda ya convertido a https://", async () => {
  state.role = "owner"
  state.lastWrite = null
  await unidades.updateUnit(
    form({ id: "u1", name: "Cabaña", capacity: "2", airbnb_ical_url: "webcal://www.airbnb.com/calendar/ical/9.ics" })
  )
  assert.equal(state.lastWrite.values.airbnb_ical_url, "https://www.airbnb.com/calendar/ical/9.ics")
  assert.equal(state.lastWrite.values.booking_ical_url, null)
})
