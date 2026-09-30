/**
 * Dominio público: ningún link armado por la app puede quedar en *.vercel.app.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { "@/": root + "src/" }, moduleCache: false })
const { configuredOrigin, CANONICAL_ORIGIN } = await jiti.import(root + "src/lib/site-origin.ts")

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
