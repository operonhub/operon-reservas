/**
 * Dominio público: ningún link armado por la app puede quedar en *.vercel.app.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { "@/": root + "src/" }, moduleCache: false })
const jitiMod = await jiti.import(root + "src/lib/site-origin.ts")
const { configuredOrigin, CANONICAL_ORIGIN } = jitiMod

test("un dominio propio configurado se respeta, sin barra final", () => {
  assert.equal(configuredOrigin("https://www.operonreservas.com/", "production"), "https://www.operonreservas.com")
  assert.equal(configuredOrigin("https://otro.com", "production"), "https://otro.com")
  assert.equal(configuredOrigin("http://localhost:3040", undefined), "http://localhost:3040")
})

test("un dominio de Vercel configurado se ignora: en producción, el propio", () => {
  for (const stale of ["https://operon-reservas.vercel.app", "https://operon-reservas-beta.vercel.app/", " https://x-y.vercel.app "]) {
    assert.equal(configuredOrigin(stale, "production"), CANONICAL_ORIGIN, stale)
  }
})

test("sin valor: en producción el propio; fuera de producción, ninguno", () => {
  assert.equal(configuredOrigin(undefined, "production"), CANONICAL_ORIGIN)
  assert.equal(configuredOrigin("", "production"), CANONICAL_ORIGIN)
  assert.equal(configuredOrigin("no es una url", "production"), CANONICAL_ORIGIN)
  assert.equal(configuredOrigin(undefined, undefined), null)
  assert.equal(configuredOrigin(undefined, "preview"), null)
  assert.equal(configuredOrigin("https://x.vercel.app", "preview"), null)
})

test("el dominio propio no es de Vercel", () => {
  assert.equal(new URL(CANONICAL_ORIGIN).hostname.endsWith(".vercel.app"), false)
})

test("una página pedida por un dominio de Vercel, en producción, va al dominio propio", () => {
  const go = (u, m = "GET", env = "production") => jitiMod.canonicalRedirect(new URL(u), m, CANONICAL_ORIGIN, env)
  assert.equal(go("https://operon-reservas.vercel.app/login"), "https://www.operonreservas.com/login")
  assert.equal(go("https://operon-reservas-santiago-lg-projects1.vercel.app/reservar/la-ponderosa?x=1"), "https://www.operonreservas.com/reservar/la-ponderosa?x=1")
  assert.equal(go("https://operon-reservas.vercel.app/"), "https://www.operonreservas.com/")
  assert.equal(go("https://operon-reservas.vercel.app/", "HEAD"), "https://www.operonreservas.com/")
})

test("no se redirige: dominio propio, vistas previas, envíos ni rutas de programas", () => {
  const go = (u, m = "GET", env = "production") => jitiMod.canonicalRedirect(new URL(u), m, CANONICAL_ORIGIN, env)
  assert.equal(go("https://www.operonreservas.com/login"), null)
  assert.equal(go("https://operonreservas.com/login"), null)
  assert.equal(go("http://localhost:3040/login"), null)
  assert.equal(go("https://x.vercel.app/login", "GET", "preview"), null)
  assert.equal(go("https://x.vercel.app/login", "GET", "development"), null)
  assert.equal(go("https://x.vercel.app/reservar/a", "POST"), null)
  assert.equal(go("https://x.vercel.app/api/mp/webhook?org=1", "POST"), null)
  assert.equal(go("https://x.vercel.app/api/cron/zone-month"), null)
  assert.equal(go("https://x.vercel.app/ical/abc?t=1"), null)
  // Un dominio que solo contiene "vercel.app" en el medio no es de Vercel.
  assert.equal(go("https://vercel.app.evil.com/login"), null)
})
