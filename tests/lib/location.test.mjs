/**
 * Ubicación estructurada (migración 0036): qué se acepta del navegador, cómo
 * se elige la localidad y qué le llega a complete_setup.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const root = fileURLToPath(new URL("../../", import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { "@/": root + "src/" }, moduleCache: false })
const t = await jiti.import(root + "src/lib/location/types.ts")
const g = await jiti.import(root + "src/lib/location/georef.ts")
const d = await jiti.import(root + "src/lib/onboarding/setup-draft.ts")

const traful = { address: "Villa Traful, Neuquén", lat: -40.655, lng: -71.405, placeId: "ChIJ-traful", googleLocality: "Villa Traful" }
const official = {
  provincia: { id: "58", nombre: "Neuquén" },
  departamento: { id: "58070", nombre: "Los Lagos" },
  municipio: { id: "585070", nombre: "Villa Traful" },
}

test("del navegador se acepta un punto dentro de la Argentina, con dirección", () => {
  assert.deepEqual(t.parsePickedPlace(traful), traful)
  assert.equal(t.parsePickedPlace({ ...traful, lat: 48.85, lng: 2.35 }), null) // París
  assert.equal(t.parsePickedPlace({ ...traful, lat: "-40" }), null)
  assert.equal(t.parsePickedPlace({ ...traful, address: "  " }), null)
  assert.equal(t.parsePickedPlace(null), null)
  assert.equal(t.parsePickedPlace({ ...traful, lat: Number.NaN }), null)
  // Textos largos se recortan en vez de romper la base.
  assert.equal(t.parsePickedPlace({ ...traful, address: "x".repeat(500) }).address.length, 200)
})

test("la localidad es el municipio oficial; sin municipio, la de Google; si no, el departamento", () => {
  const full = g.buildLocation(traful, official)
  assert.equal(full.city, "Villa Traful")
  assert.equal(full.localityId, "585070")
  assert.equal(full.provinceName, "Neuquén")
  assert.equal(full.departmentId, "58070")

  // Zona rural: el punto no cae en ningún municipio.
  const rural = g.buildLocation({ ...traful, googleLocality: "Paraje El Manso" }, { ...official, municipio: null })
  assert.equal(rural.city, "Paraje El Manso")
  assert.equal(rural.localityId, null)
  assert.equal(g.buildLocation({ ...traful, googleLocality: null }, { ...official, municipio: null }).city, "Los Lagos")

  // Georef caído: se guarda el punto y la localidad de Google.
  const offline = g.buildLocation(traful, null)
  assert.equal(offline.city, "Villa Traful")
  assert.equal(offline.provinceId, null)
  assert.equal(offline.lat, -40.655)
})

test("officialPlace lee la respuesta de Georef y ante cualquier falla devuelve null", async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /apis\.datos\.gob\.ar\/georef\/api\/ubicacion\?lat=-40\.655&lon=-71\.405/)
      return Response.json({ ubicacion: { ...official, lat: -40.655, lon: -71.405 } })
    }
    assert.deepEqual(await g.officialPlace(-40.655, -71.405), official)
    globalThis.fetch = async () => new Response("", { status: 500 })
    assert.equal(await g.officialPlace(-40.655, -71.405), null)
    globalThis.fetch = async () => { throw new Error("sin red") }
    assert.equal(await g.officialPlace(-40.655, -71.405), null)
  } finally { globalThis.fetch = original }
})

test("el borrador guarda la ubicación válida, descarta la inválida, y la ciudad sale de ahí", () => {
  const location = g.buildLocation(traful, official)
  const draft = d.normalizeDraft({ name: "Cabañas del Lago", city: "texto viejo", location })
  assert.deepEqual(draft.location, location)
  assert.equal(d.normalizeDraft({ location: { ...location, lat: 10 } }).location, null)
  assert.equal(d.normalizeDraft({}).location, null)

  const payload = d.toSetupPayload({ ...d.emptyDraft(), name: "X", slug: "x-x", city: "texto viejo", units: [] }, location)
  assert.equal(payload.city, "Villa Traful")
  assert.deepEqual(payload.location, {
    address: "Villa Traful, Neuquén", lat: -40.655, lng: -71.405, place_id: "ChIJ-traful",
    province_id: "58", province_name: "Neuquén", department_id: "58070", department_name: "Los Lagos",
    locality_id: "585070", city: "Villa Traful",
  })
  // Sin ubicación, como siempre: la ciudad escrita.
  const plain = d.toSetupPayload({ ...d.emptyDraft(), city: " Villa Yacanto ", units: [] }, null)
  assert.equal(plain.city, "Villa Yacanto")
  assert.equal(plain.location, null)
})

test("solo pesos: un borrador viejo en dólares vuelve a pesos", () => {
  assert.equal(d.normalizeDraft({ currency: "USD" }).currency, "ARS")
  assert.equal(d.stepError(2, { ...d.emptyDraft(), currency: "USD" }), "Elegí una moneda.")
})
