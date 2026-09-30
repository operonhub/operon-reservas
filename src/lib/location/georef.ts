import type { PickedPlace, PropertyLocation } from "./types"

/**
 * Georef: la API de normalización geográfica del Estado argentino (gratis,
 * sin clave). Con un punto devuelve provincia, departamento y municipio con
 * sus códigos oficiales. No sirve como buscador de direcciones (por eso el
 * buscador es Google), pero sí para saber a qué localidad pertenece un punto.
 * https://apis.datos.gob.ar/georef
 */
const GEOREF = "https://apis.datos.gob.ar/georef/api/ubicacion"

type Named = { id: string; nombre: string } | null
export type OfficialPlace = { provincia: Named; departamento: Named; municipio: Named }

export async function officialPlace(lat: number, lng: number): Promise<OfficialPlace | null> {
  try {
    const url = `${GEOREF}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" })
    if (!res.ok) return null
    const body = (await res.json()) as { ubicacion?: Record<string, unknown> }
    const u = body.ubicacion
    if (!u) return null
    const named = (value: unknown): Named => {
      const v = value as { id?: unknown; nombre?: unknown } | null
      return v && typeof v.id === "string" && typeof v.nombre === "string" ? { id: v.id, nombre: v.nombre } : null
    }
    return { provincia: named(u.provincia), departamento: named(u.departamento), municipio: named(u.municipio) }
  } catch {
    // Georef caído o lento: se guarda el punto igual y la localidad de Google.
    return null
  }
}

/**
 * Arma la ubicación final. La localidad es, en orden: el municipio oficial;
 * si el punto cae fuera de un municipio (zona rural), la localidad de Google;
 * y si tampoco hay, el departamento.
 */
export function buildLocation(picked: PickedPlace, official: OfficialPlace | null): PropertyLocation {
  const municipio = official?.municipio ?? null
  return {
    address: picked.address,
    lat: picked.lat,
    lng: picked.lng,
    placeId: picked.placeId,
    provinceId: official?.provincia?.id ?? null,
    provinceName: official?.provincia?.nombre ?? null,
    departmentId: official?.departamento?.id ?? null,
    departmentName: official?.departamento?.nombre ?? null,
    localityId: municipio?.id ?? null,
    city: municipio?.nombre ?? picked.googleLocality ?? official?.departamento?.nombre ?? null,
  }
}

export async function resolvePickedPlace(picked: PickedPlace): Promise<PropertyLocation> {
  return buildLocation(picked, await officialPlace(picked.lat, picked.lng))
}
