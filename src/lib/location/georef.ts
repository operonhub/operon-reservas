import type { PickedPlace, PropertyLocation } from "./types"

/**
 * Georef: la API de normalización geográfica del Estado argentino (gratis,
 * sin clave). https://apis.datos.gob.ar/georef
 *
 * Con un punto devuelve provincia, departamento y municipio. Pero el
 * municipio NO es el pueblo en todas las provincias: en Buenos Aires es el
 * partido (Villa Ventana cae en el municipio "Tornquist"). El pueblo es la
 * "localidad", que Georef no da por coordenadas; se busca en su lista oficial
 * con el nombre que da Google y, si no aparece, la más cercana al punto.
 */
const GEOREF = "https://apis.datos.gob.ar/georef/api"
/** Una localidad más lejos que esto del pin no es "la del complejo". */
const MAX_KM = 25

type Named = { id: string; nombre: string } | null
export type OfficialLocality = { id: string; nombre: string; lat: number; lon: number }
export type OfficialPlace = {
  provincia: Named
  departamento: Named
  municipio: Named
  localidad: OfficialLocality | null
}

async function georef(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${GEOREF}/${path}`, { signal: AbortSignal.timeout(5000), cache: "no-store" })
  return res.ok ? ((await res.json()) as Record<string, unknown>) : null
}

const named = (value: unknown): Named => {
  const v = value as { id?: unknown; nombre?: unknown } | null
  return v && typeof v.id === "string" && typeof v.nombre === "string" ? { id: v.id, nombre: v.nombre } : null
}

function localities(body: Record<string, unknown> | null): OfficialLocality[] {
  const list = Array.isArray(body?.localidades) ? body.localidades : []
  return list.flatMap((raw) => {
    const l = raw as { id?: unknown; nombre?: unknown; centroide?: { lat?: unknown; lon?: unknown } }
    const lat = l.centroide?.lat
    const lon = l.centroide?.lon
    return typeof l.id === "string" && typeof l.nombre === "string" && typeof lat === "number" && typeof lon === "number"
      ? [{ id: l.id, nombre: l.nombre, lat, lon }]
      : []
  })
}

/** "Villa  Ventana" y "villa ventana" son la misma; las tildes tampoco cuentan. */
export function sameName(a: string, b: string) {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
  return norm(a) === norm(b)
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = (d: number) => (d * Math.PI) / 180
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

/**
 * La localidad del complejo: la que nombró Google, si existe en la lista
 * oficial de esa provincia y no está claramente más lejos que la más
 * cercana del departamento (zona rural: Google suele saber a qué pueblo
 * "pertenece" la cabaña); si no, la más cercana. Nunca una a más de MAX_KM.
 * El margen evita que un pin movido a otro pueblo quede con el nombre viejo.
 */
const HINT_MARGIN_KM = 2

export function pickLocality(
  lat: number,
  lng: number,
  byName: OfficialLocality[],
  inDepartment: OfficialLocality[],
  hint: string | null
): OfficialLocality | null {
  const km = (l: OfficialLocality) => distanceKm(lat, lng, l.lat, l.lon)
  const nearest = [...inDepartment].sort((a, b) => km(a) - km(b))[0]
  const byHint = hint ? byName.find((l) => sameName(l.nombre, hint)) : undefined
  if (byHint && km(byHint) <= MAX_KM && (!nearest || km(byHint) <= km(nearest) + HINT_MARGIN_KM)) return byHint
  return nearest && km(nearest) <= MAX_KM ? nearest : null
}

export async function officialPlace(lat: number, lng: number, hint: string | null = null): Promise<OfficialPlace | null> {
  try {
    const point = await georef(`ubicacion?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`)
    const u = point?.ubicacion as Record<string, unknown> | undefined
    if (!u) return null
    const provincia = named(u.provincia)
    const departamento = named(u.departamento)
    const fields = "campos=id,nombre,centroide"
    const [byName, inDepartment] = await Promise.all([
      hint && provincia
        ? georef(`localidades?nombre=${encodeURIComponent(hint)}&provincia=${provincia.id}&max=10&${fields}`).catch(() => null)
        : null,
      departamento
        ? georef(`localidades?departamento=${departamento.id}&max=500&${fields}`).catch(() => null)
        : null,
    ])
    return {
      provincia,
      departamento,
      municipio: named(u.municipio),
      localidad: pickLocality(lat, lng, localities(byName), localities(inDepartment), hint),
    }
  } catch {
    // Georef caído o lento: se guarda el punto igual y la localidad de Google.
    return null
  }
}

/**
 * Arma la ubicación final. La ciudad es, en orden: la localidad oficial; la
 * localidad de Google; el municipio; el departamento.
 */
export function buildLocation(picked: PickedPlace, official: OfficialPlace | null): PropertyLocation {
  return {
    address: picked.address,
    lat: picked.lat,
    lng: picked.lng,
    placeId: picked.placeId,
    provinceId: official?.provincia?.id ?? null,
    provinceName: official?.provincia?.nombre ?? null,
    departmentId: official?.departamento?.id ?? null,
    departmentName: official?.departamento?.nombre ?? null,
    localityId: official?.localidad?.id ?? null,
    city:
      official?.localidad?.nombre ??
      picked.googleLocality ??
      official?.municipio?.nombre ??
      official?.departamento?.nombre ??
      null,
  }
}

export async function resolvePickedPlace(picked: PickedPlace): Promise<PropertyLocation> {
  return buildLocation(picked, await officialPlace(picked.lat, picked.lng, picked.googleLocality))
}
