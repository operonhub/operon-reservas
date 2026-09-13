/**
 * El link público del complejo: la regla del navegador tiene que coincidir con
 * la de la base (app_private.slug_is_valid, migración 0026).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const jiti = createJiti(import.meta.url, { moduleCache: false })
const { slugify, toSlugInput, isValidSlug, RESERVED_SLUGS } = await jiti.import(root + "src/lib/slug.ts")

test("escribir el link a mano convierte tildes, eñes y espacios en vez de borrarlos", () => {
  assert.equal(toSlugInput("cabañas anashe"), "cabanas-anashe")
  // El guion final se deja para poder seguir escribiendo.
  assert.equal(toSlugInput("cabanas "), "cabanas-")
  assert.equal(toSlugInput("Refugio  --  Ñandú"), "refugio-nandu")
  assert.equal(toSlugInput(" -lago"), "lago")
})

test("slugify saca tildes, eñes, símbolos y respeta el largo máximo", () => {
  assert.equal(slugify("Cabañas del Ñandú"), "cabanas-del-nandu")
  assert.equal(slugify("  La Balconada — SMA!! "), "la-balconada-sma")
  assert.equal(slugify("a".repeat(60) + " b"), "a".repeat(48))
  // El corte a 48 caracteres cae justo después de un guion: no queda colgando.
  assert.equal(slugify("Refugio " + "x".repeat(39) + " Alto"), "refugio-" + "x".repeat(39))
})

test("isValidSlug acepta links sanos y rechaza cortos, raros y reservados", () => {
  for (const ok of ["alto-cielo", "abc", "cabanas-2", "9-lunas"]) assert.equal(isValidSlug(ok), true, ok)
  for (const bad of ["ab", "-cabana", "cabana-", "doble--guion", "Mayus", "con espacio", "demo", "reservar", "a".repeat(49)]) {
    assert.equal(isValidSlug(bad), false, bad)
  }
})

test("las palabras reservadas coinciden con las de la migración 0026", () => {
  const sql = readFileSync(root + "supabase/migrations/0026_primer_uso.sql", "utf8")
  const block = sql.match(/p_slug <> all \(array\[([\s\S]*?)\]\)/)[1]
  const fromSql = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual([...RESERVED_SLUGS].sort(), fromSql)
})
