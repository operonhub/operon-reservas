"use client"

import * as React from "react"
import { LoaderCircle, MapPin, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { resolveLocation } from "@/app/location-actions"
import { locationLabel, type PickedPlace, type PropertyLocation } from "@/lib/location/types"
import { cn } from "@/lib/utils"
import {
  GOOGLE_MAPS_KEY,
  googleLocality,
  loadGoogleMaps,
  type GoogleMap,
  type PlacePrediction,
} from "./google-maps"

/** Hay clave de Google: si no, el que lo usa muestra el campo de texto de siempre. */
export const locationPickerAvailable = GOOGLE_MAPS_KEY.length > 0

type Suggestion = { id: string; main: string; secondary: string; prediction: PlacePrediction }

/**
 * Buscador de dirección + mapa para ajustar el punto (0036). El pin queda fijo
 * en el centro y se mueve el mapa: en el celular es más fácil que arrastrar un
 * marcador. Con el punto, el servidor pide a Georef la localidad oficial.
 */
export function LocationPicker({
  value,
  onChange,
  inputClassName,
  fallback,
  autoFocus,
}: {
  value: PropertyLocation | null
  onChange: (location: PropertyLocation | null) => void
  inputClassName?: string
  /** Lo que se muestra si Google no carga (clave inválida, sin red). */
  fallback: React.ReactNode
  autoFocus?: boolean
}) {
  const listId = React.useId()
  const [query, setQuery] = React.useState(value?.address ?? "")
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([])
  const [active, setActive] = React.useState(-1)
  const [searching, setSearching] = React.useState(false)
  const [resolving, setResolving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const session = React.useRef<object | null>(null)
  const requestId = React.useRef(0)
  // Estable: el mapa se crea en un efecto que depende de esta función.
  const fail = React.useCallback(() => setFailed(true), [])

  // Resuelve la localidad oficial en el servidor. Solo la última respuesta cuenta.
  const resolve = React.useCallback(
    async (picked: PickedPlace) => {
      const id = ++requestId.current
      setResolving(true)
      const location = await resolveLocation(picked).catch(() => null)
      if (id !== requestId.current) return
      setResolving(false)
      if (location) onChange(location)
    },
    [onChange]
  )

  async function search(input: string) {
    setQuery(input)
    setActive(-1)
    if (input.trim().length < 3) {
      setSuggestions([])
      return
    }
    setSearching(true)
    try {
      const google = await loadGoogleMaps()
      const places = await google.maps.importLibrary("places")
      session.current ??= new places.AutocompleteSessionToken()
      const { suggestions: found } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: session.current,
        includedRegionCodes: ["ar"],
        language: "es",
        region: "ar",
      })
      setSuggestions(
        found
          .map((s) => s.placePrediction)
          .filter((p): p is PlacePrediction => p !== null)
          .slice(0, 5)
          .map((p) => ({
            id: p.placeId,
            main: p.mainText?.text ?? p.text.text,
            secondary: p.secondaryText?.text ?? "",
            prediction: p,
          }))
      )
    } catch {
      setFailed(true)
    } finally {
      setSearching(false)
    }
  }

  async function choose(suggestion: Suggestion) {
    setSuggestions([])
    setQuery(suggestion.prediction.text.text)
    try {
      const place = suggestion.prediction.toPlace()
      await place.fetchFields({ fields: ["location", "formattedAddress", "addressComponents"] })
      // Cierra la sesión de búsqueda: Google cobra por sesión, no por tecla.
      session.current = null
      if (!place.location) return
      const address = place.formattedAddress ?? suggestion.prediction.text.text
      setQuery(address)
      await resolve({
        address,
        lat: place.location.lat(),
        lng: place.location.lng(),
        placeId: suggestion.id,
        googleLocality: googleLocality(place.addressComponents),
      })
    } catch {
      setFailed(true)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault()
      void choose(suggestions[active])
    } else if (event.key === "Escape") {
      setSuggestions([])
    }
  }

  if (failed) return <>{fallback}</>

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Buscá la dirección de tu complejo"
          value={query}
          onChange={(e) => void search(e.target.value)}
          onKeyDown={onKeyDown}
          className={cn("pl-9", inputClassName)}
        />
        {searching && (
          <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {suggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
          >
            {suggestions.map((s, index) => (
              <li
                key={s.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(e) => {
                  // mousedown: si fuera click, el blur del input cerraría la lista antes.
                  e.preventDefault()
                  void choose(s)
                }}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-sm",
                  index === active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                )}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.main}</span>
                  {s.secondary && <span className="block truncate text-xs text-muted-foreground">{s.secondary}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {value && (
        <>
          <PinMap
            key={`${value.placeId ?? "manual"}`}
            lat={value.lat}
            lng={value.lng}
            onMove={(lat, lng) =>
              void resolve({
                address: value.address,
                lat,
                lng,
                placeId: value.placeId,
                googleLocality: value.localityId ? null : value.city,
              })
            }
            onFail={fail}
          />
          <div className="flex items-start justify-between gap-3 text-sm">
            <p className="flex items-start gap-2">
              {resolving ? (
                <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              )}
              <span>
                <span className="font-medium">{locationLabel(value) || "Ubicación marcada"}</span>
                <span className="block text-xs text-muted-foreground">
                  Mové el mapa si el pin no está justo sobre tu complejo.
                </span>
              </span>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("")
                onChange(null)
              }}
            >
              <X /> Quitar
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Mapa con el pin fijo en el centro. Avisa el nuevo centro cuando se deja de mover. */
function PinMap({
  lat,
  lng,
  onMove,
  onFail,
}: {
  lat: number
  lng: number
  onMove: (lat: number, lng: number) => void
  onFail: () => void
}) {
  const element = React.useRef<HTMLDivElement>(null)
  const map = React.useRef<GoogleMap | null>(null)
  const last = React.useRef({ lat, lng })
  // El listener del mapa se crea una vez; siempre llama a la versión vigente.
  const onMoveRef = React.useRef(onMove)
  React.useEffect(() => {
    onMoveRef.current = onMove
  })

  React.useEffect(() => {
    let cancelled = false
    let listener: { remove(): void } | null = null
    loadGoogleMaps()
      .then((google) => google.maps.importLibrary("maps"))
      .then(({ Map }) => {
        if (cancelled || !element.current) return
        map.current = new Map(element.current, {
          center: last.current,
          zoom: 16,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          mapTypeId: "hybrid",
        })
        listener = map.current.addListener("idle", () => {
          const center = map.current?.getCenter()
          if (!center) return
          const moved = { lat: center.lat(), lng: center.lng() }
          // Ignora el "idle" inicial y movimientos de menos de ~5 metros.
          if (Math.abs(moved.lat - last.current.lat) < 0.00005 && Math.abs(moved.lng - last.current.lng) < 0.00005) return
          last.current = moved
          onMoveRef.current(moved.lat, moved.lng)
        })
      })
      .catch(onFail)
    return () => {
      cancelled = true
      listener?.remove()
    }
  }, [onFail])

  return (
    <div className="relative h-56 overflow-hidden rounded-lg border bg-muted">
      <div ref={element} className="absolute inset-0" />
      <MapPin
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-full fill-primary text-primary-foreground drop-shadow"
      />
    </div>
  )
}
