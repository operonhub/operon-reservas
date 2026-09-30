/**
 * Carga de Google Maps en el navegador, una sola vez por página.
 *
 * Tipos mínimos a mano en vez de @types/google.maps: se usan cinco cosas y
 * no vale la pena otra dependencia. Places (New): AutocompleteSuggestion y
 * Place — el Places viejo (AutocompleteService) ya no se habilita en
 * proyectos nuevos de Google Cloud desde 2025.
 */

export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""

export type LatLng = { lat(): number; lng(): number }

export type AddressComponent = { longText: string | null; types: string[] }

export type Place = {
  location: LatLng | null
  formattedAddress: string | null
  addressComponents: AddressComponent[] | null
  fetchFields(options: { fields: string[] }): Promise<unknown>
}

export type PlacePrediction = {
  placeId: string
  text: { text: string }
  mainText: { text: string } | null
  secondaryText: { text: string } | null
  toPlace(): Place
}

type PlacesLibrary = {
  AutocompleteSessionToken: new () => object
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {
      input: string
      sessionToken: object
      includedRegionCodes: string[]
      language: string
      region: string
    }): Promise<{ suggestions: { placePrediction: PlacePrediction | null }[] }>
  }
}

export type GoogleMap = {
  getCenter(): LatLng | undefined
  setCenter(center: { lat: number; lng: number }): void
  setZoom(zoom: number): void
  addListener(event: string, handler: () => void): { remove(): void }
}

type MapsLibrary = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap
}

type GoogleNamespace = {
  maps: { importLibrary(name: "places"): Promise<PlacesLibrary>; importLibrary(name: "maps"): Promise<MapsLibrary> }
}

let loading: Promise<GoogleNamespace> | null = null

export function loadGoogleMaps(): Promise<GoogleNamespace> {
  if (loading) return loading
  loading = new Promise<GoogleNamespace>((resolve, reject) => {
    const w = window as unknown as { google?: GoogleNamespace; __operonMapsReady?: () => void }
    if (w.google?.maps?.importLibrary) return resolve(w.google)
    w.__operonMapsReady = () => (w.google ? resolve(w.google) : reject(new Error("GOOGLE_MAPS_MISSING")))
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_KEY,
      v: "weekly",
      loading: "async",
      language: "es",
      region: "AR",
      callback: "__operonMapsReady",
    })
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onerror = () => {
      loading = null
      reject(new Error("GOOGLE_MAPS_LOAD_FAILED"))
    }
    document.head.appendChild(script)
  })
  return loading
}

/** La localidad según Google: respaldo para zonas rurales sin municipio oficial. */
export function googleLocality(components: AddressComponent[] | null) {
  const find = (type: string) => components?.find((c) => c.types.includes(type))?.longText ?? null
  return find("locality") ?? find("administrative_area_level_2") ?? null
}
