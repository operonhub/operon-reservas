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

// Caso real: en Buenos Aires el municipio es el partido. Villa Ventana cae en
// el municipio "Tornquist", pero el pueblo es la localidad "Villa Ventana".
const ponderosa = { address: "Cruz del Sur 180, Villa Ventana", lat: -38.0768, lng: -61.9274, placeId: "ChIJ-ponderosa", googleLocality: "Villa Ventana" }
const VILLA_VENTANA = { id: "06819070", nombre: "Villa Ventana", lat: -38.0819, lon: -61.9298 }
const SIERRA = { id: "06819060", nombre: "Sierra de la Ventana", lat: -38.1388, lon: -61.7955 }
const TORNQUIST = { id: "06819050", nombre: "Tornquist", lat: -38.1003, lon: -62.2227 }
const official = {
  provincia: { id: "06", nombre: "Buenos Aires" },
  departamento: { id: "06819", nombre: "Tornquist" },
  municipio: { id: "060819", nombre: "Tornquist" },
  localidad: VILLA_VENTANA,
}

test("del navegador se acepta un punto dentro de la Argentina, con dirección", () => {
  assert.deepEqual(t.parsePickedPlace(ponderosa), ponderosa)
  assert.equal(t.parsePickedPlace({ ...ponderosa, lat: 48.85, lng: 2.35 }), null) // París
  assert.equal(t.parsePickedPlace({ ...ponderosa, lat: "-40" }), null)
  assert.equal(t.parsePickedPlace({ ...ponderosa, address: "  " }), null)
  assert.equal(t.parsePickedPlace(null), null)
  assert.equal(t.parsePickedPlace({ ...ponderosa, lat: Number.NaN }), null)
  assert.equal(t.parsePickedPlace({ ...ponderosa, address: "x".repeat(500) }).address.length, 200)
})

test("la localidad es la que nombra Google si existe cerca; si no, la más cercana del departamento", () => {
  const { lat, lng } = ponderosa
  // Google dice Villa Ventana y está a pocos metros: esa.
  assert.equal(g.pickLocality(lat, lng, [VILLA_VENTANA], [TORNQUIST, SIERRA, VILLA_VENTANA], "villa ventána").id, "06819070")
  // Sin pista de Google (zona rural): la más cercana del departamento.
  assert.equal(g.pickLocality(lat, lng, [], [TORNQUIST, SIERRA, VILLA_VENTANA], null).nombre, "Villa Ventana")
  // Pin movido lejos del pueblo de la pista (quedó la ciudad vieja): gana la más cercana.
  assert.equal(g.pickLocality(-38.1388, -61.7955, [VILLA_VENTANA], [TORNQUIST, SIERRA, VILLA_VENTANA], "Villa Ventana").nombre, "Sierra de la Ventana")
  // Nada a menos de 25 km: ninguna.
  assert.equal(g.pickLocality(-39.5, -63.5, [], [TORNQUIST, SIERRA, VILLA_VENTANA], null), null)
})

test("la ciudad: localidad oficial, si no la de Google, si no el municipio, si no el departamento", () => {
  const full = g.buildLocation(ponderosa, official)
  assert.equal(full.city, "Villa Ventana")
  assert.equal(full.localityId, "06819070")
  assert.equal(full.provinceName, "Buenos Aires")
  assert.equal(full.departmentId, "06819")

  assert.equal(g.buildLocation(ponderosa, { ...official, localidad: null }).city, "Villa Ventana") // Google
  assert.equal(g.buildLocation({ ...ponderosa, googleLocality: null }, { ...official, localidad: null }).city, "Tornquist")
  assert.equal(g.buildLocation({ ...ponderosa, googleLocality: null }, { ...official, localidad: null, municipio: null }).city, "Tornquist")

  // Georef caído: se guarda el punto y la localidad de Google.
  const offline = g.buildLocation(ponderosa, null)
  assert.equal(offline.city, "Villa Ventana")
  assert.equal(offline.provinceId, null)
  assert.equal(offline.lat, -38.0768)
})

test("officialPlace consulta el punto y las localidades, y ante cualquier falla devuelve null", async () => {
  const original = globalThis.fetch
  const center = (l) => ({ id: l.id, nombre: l.nombre, centroide: { lat: l.lat, lon: l.lon } })
  try {
    const urls = []
    globalThis.fetch = async (url) => {
      urls.push(String(url))
      if (String(url).includes("/ubicacion?")) {
        return Response.json({ ubicacion: { provincia: official.provincia, departamento: official.departamento, municipio: official.municipio } })
      }
      if (String(url).includes("nombre=")) return Response.json({ localidades: [center(VILLA_VENTANA)] })
      return Response.json({ localidades: [center(TORNQUIST), center(SIERRA), center(VILLA_VENTANA)] })
    }
    const place = await g.officialPlace(ponderosa.lat, ponderosa.lng, "Villa Ventana")
    assert.equal(place.localidad.id, "06819070")
    assert.equal(place.municipio.nombre, "Tornquist")
    assert.ok(urls.some((u) => /localidades\?nombre=Villa%20Ventana&provincia=06/.test(u)))
    assert.ok(urls.some((u) => /localidades\?departamento=06819/.test(u)))

    globalThis.fetch = async () => new Response("", { status: 500 })
    assert.equal(await g.officialPlace(ponderosa.lat, ponderosa.lng), null)
    globalThis.fetch = async () => { throw new Error("sin red") }
    assert.equal(await g.officialPlace(ponderosa.lat, ponderosa.lng), null)
  } finally { globalThis.fetch = original }
})

test("el borrador guarda la ubicación válida, descarta la inválida, y la ciudad sale de ahí", () => {
  const location = g.buildLocation(ponderosa, official)
  const draft = d.normalizeDraft({ name: "Cabañas del Lago", city: "texto viejo", location })
  assert.deepEqual(draft.location, location)
  assert.equal(d.normalizeDraft({ location: { ...location, lat: 10 } }).location, null)
  assert.equal(d.normalizeDraft({}).location, null)

  const payload = d.toSetupPayload({ ...d.emptyDraft(), name: "X", slug: "x-x", city: "texto viejo", units: [] }, location)
  assert.equal(payload.city, "Villa Ventana")
  assert.deepEqual(payload.location, {
    address: "Cruz del Sur 180, Villa Ventana", lat: -38.0768, lng: -61.9274, place_id: "ChIJ-ponderosa",
    province_id: "06", province_name: "Buenos Aires", department_id: "06819", department_name: "Tornquist",
    locality_id: "06819070", city: "Villa Ventana",
  })
  const plain = d.toSetupPayload({ ...d.emptyDraft(), city: " Villa Yacanto ", units: [] }, null)
  assert.equal(plain.city, "Villa Yacanto")
  assert.equal(plain.location, null)
})

test("solo pesos: un borrador viejo en dólares vuelve a pesos", () => {
  assert.equal(d.normalizeDraft({ currency: "USD" }).currency, "ARS")
  assert.equal(d.stepError(2, { ...d.emptyDraft(), currency: "USD" }), "Elegí una moneda.")
})
