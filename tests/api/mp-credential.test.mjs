/**
 * getValidCredential real (src/lib/mp-credential.ts) con la API de Mercado
 * Pago simulada y un cliente de Supabase mínimo que responde en orden.
 */
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"
import { state, reset } from "./mocks/state.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const mocks = fileURLToPath(new URL("./mocks/", import.meta.url))
const jiti = createJiti(import.meta.url, {
  alias: { "@/lib/mercadopago": mocks + "mercadopago.mjs", "@/": root + "src/" },
  moduleCache: false,
})
const { getValidCredential } = await jiti.import(root + "src/lib/mp-credential.ts")

const DAY = 24 * 60 * 60 * 1000
const credential = (msToExpiry) => ({
  organization_id: "org-a", access_token: "tok-viejo", refresh_token: "refresh-viejo",
  expires_at: new Date(Date.now() + msToExpiry).toISOString(), live_mode: true,
})

/** saves: lo que responde cada intento de guardar los tokens, en orden. */
function fakeAdmin({ cred = credential(DAY), getError = null, saves = [] } = {}) {
  const pending = [...saves]
  return {
    saveCalls: 0,
    async rpc(fn, args) {
      if (fn === "mp_service_get_credential") return { data: getError ? null : cred, error: getError }
      if (fn === "mp_service_update_tokens") {
        this.saveCalls++
        this.lastSave = args
        return { data: null, error: pending.shift() ?? null }
      }
      throw new Error(`RPC inesperada: ${fn}`)
    },
  }
}

let logs = []
beforeEach(() => { reset(); logs = []; console.error = (...a) => logs.push(a.map(String).join(" ")) })

test("un token lejos de vencer se usa tal cual, sin renovar", async () => {
  const admin = fakeAdmin({ cred: credential(10 * DAY) })
  const cred = await getValidCredential(admin, "org-a")
  assert.equal(cred.access_token, "tok-viejo")
  assert.equal(state.refreshCalls, undefined)
})

test("un token por vencer se renueva y se guarda el nuevo", async () => {
  const admin = fakeAdmin()
  const cred = await getValidCredential(admin, "org-a")
  assert.equal(cred.access_token, "tok-nuevo")
  assert.equal(admin.saveCalls, 1)
  assert.equal(admin.lastSave.p_refresh_token, "refresh-nuevo")
  assert.deepEqual(logs, [])
})

test("N-02: si guardar falla una vez, se reintenta sin avisar", async () => {
  const admin = fakeAdmin({ saves: [{ message: "timeout" }] })
  const cred = await getValidCredential(admin, "org-a")
  assert.equal(cred.access_token, "tok-nuevo")
  assert.equal(admin.saveCalls, 2)
  assert.deepEqual(logs, [])
})

test("N-02: si guardar falla dos veces, sigue con el token nuevo y deja aviso", async () => {
  const admin = fakeAdmin({ saves: [{ message: "db down" }, { message: "db down" }] })
  const cred = await getValidCredential(admin, "org-a")
  assert.equal(cred.access_token, "tok-nuevo", "este pedido no tiene por qué fallar")
  assert.equal(admin.saveCalls, 2)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /org-a/)
  assert.match(logs[0], /reconectar Mercado Pago/)
  assert.doesNotMatch(logs[0], /tok-nuevo|refresh-nuevo/, "el aviso no expone los tokens")
})

test("si Mercado Pago rechaza la renovación, sigue con el token actual", async () => {
  state.refreshThrows = true
  const admin = fakeAdmin()
  const cred = await getValidCredential(admin, "org-a")
  assert.equal(cred.access_token, "tok-viejo")
  assert.equal(admin.saveCalls, 0)
})

test("un error de base al leer la credencial no se confunde con 'no conectó'", async () => {
  const admin = fakeAdmin({ getError: { message: "db down" } })
  await assert.rejects(getValidCredential(admin, "org-a"))
})
