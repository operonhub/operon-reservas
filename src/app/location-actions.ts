"use server"

import { resolvePickedPlace } from "@/lib/location/georef"
import { parsePickedPlace, type PropertyLocation } from "@/lib/location/types"

/**
 * El buscador llama a esto cada vez que el dueño elige una dirección o mueve
 * el pin, para mostrarle la localidad y la provincia oficiales. Lo que se
 * guarda se vuelve a resolver en el servidor al guardar: esto es solo para
 * mostrar.
 */
export async function resolveLocation(raw: unknown): Promise<PropertyLocation | null> {
  const picked = parsePickedPlace(raw)
  return picked ? resolvePickedPlace(picked) : null
}
