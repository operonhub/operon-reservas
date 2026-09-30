/**
 * Ubicación estructurada de un alojamiento (migración 0036).
 *
 * El dueño elige su dirección con el buscador de Google y ajusta el pin en el
 * mapa; con ese punto, Georef (API oficial del Estado argentino) devuelve la
 * provincia, el departamento y la localidad con sus códigos. La localidad
 * oficial pasa a ser la `city` del alojamiento, y de ahí sale la zona de
 * "Tu zona este mes": ya no depende de cómo la escriba cada dueño.
 */

/** Lo que devuelve el buscador en el navegador. No se confía en esto para lo oficial. */
export type PickedPlace = {
  address: string
  lat: number
  lng: number
  placeId: string | null
  /** La localidad según Google: respaldo si el punto no cae en un municipio. */
  googleLocality: string | null
}

export type PropertyLocation = {
  address: string
  lat: number
  lng: number
  placeId: string | null
  provinceId: string | null
  provinceName: string | null
  departmentId: string | null
  departmentName: string | null
  /** null cuando la localidad no viene de Georef (zona rural sin municipio). */
  localityId: string | null
  /** Lo que se guarda como `city`: municipio oficial, o Google, o el departamento. */
  city: string | null
}

/** Caja que contiene a la Argentina continental (e islas); fuera de esto es un error. */
export function inArgentina(lat: number, lng: number) {
  return lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53
}

const str = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null)

/** Lo que llega del navegador (borrador del asistente, formulario): se valida y se recorta. */
export function parsePickedPlace(raw: unknown): PickedPlace | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const lat = num(r.lat)
  const lng = num(r.lng)
  const address = str(r.address, 200)
  if (lat === null || lng === null || !address || !inArgentina(lat, lng)) return null
  return { address, lat, lng, placeId: str(r.placeId, 300), googleLocality: str(r.googleLocality, 80) }
}

/** Igual que parsePickedPlace, pero para una ubicación ya resuelta (se guarda en el borrador). */
export function parseLocation(raw: unknown): PropertyLocation | null {
  const picked = parsePickedPlace(raw)
  if (!picked) return null
  const r = raw as Record<string, unknown>
  return {
    address: picked.address,
    lat: picked.lat,
    lng: picked.lng,
    placeId: picked.placeId,
    provinceId: str(r.provinceId, 10),
    provinceName: str(r.provinceName, 80),
    departmentId: str(r.departmentId, 10),
    departmentName: str(r.departmentName, 80),
    localityId: str(r.localityId, 10),
    city: str(r.city, 80),
  }
}

/** "Villa Traful · Neuquén", para mostrar debajo del buscador y en el resumen. */
export function locationLabel(location: Pick<PropertyLocation, "city" | "provinceName">) {
  return [location.city, location.provinceName].filter(Boolean).join(" · ")
}
