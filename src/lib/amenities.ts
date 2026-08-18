import {
  Wifi, Flame, Waves, Snowflake, ThermometerSun, Car, Dog, Tv,
  CookingPot, BedDouble, Coffee, Bath, WashingMachine, Mountain,
  type LucideIcon,
} from "lucide-react"

/**
 * Catálogo de servicios de una unidad.
 *
 * Es una lista CERRADA a propósito: al ser las mismas claves para todos los
 * alojamientos, cada servicio tiene su ícono y el propietario puede comparar
 * sus unidades de un vistazo. Las claves se guardan en `units.amenities`
 * (0015) y el ícono vive únicamente acá, así el grid y el formulario no se
 * pueden desincronizar.
 *
 * Agregar una entrada nueva es seguro; renombrar una clave existente NO lo
 * es (dejaría huérfanos los valores ya guardados en la base).
 */
export const AMENITIES = {
  wifi: { label: "Wi-Fi", icon: Wifi },
  parrilla: { label: "Parrilla", icon: Flame },
  pileta: { label: "Pileta", icon: Waves },
  aire: { label: "Aire acondicionado", icon: Snowflake },
  calefaccion: { label: "Calefacción", icon: ThermometerSun },
  cochera: { label: "Cochera", icon: Car },
  mascotas: { label: "Apto mascotas", icon: Dog },
  tv: { label: "TV", icon: Tv },
  cocina: { label: "Cocina equipada", icon: CookingPot },
  ropa_blanca: { label: "Ropa blanca", icon: BedDouble },
  desayuno: { label: "Desayuno", icon: Coffee },
  hidromasaje: { label: "Hidromasaje", icon: Bath },
  lavarropas: { label: "Lavarropas", icon: WashingMachine },
  vista: { label: "Vista panorámica", icon: Mountain },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>

export type AmenityKey = keyof typeof AMENITIES

export const AMENITY_KEYS = Object.keys(AMENITIES) as AmenityKey[]

export function isAmenityKey(value: string): value is AmenityKey {
  return value in AMENITIES
}

/** Filtra lo que venga de un form o de la base al catálogo conocido. */
export function sanitizeAmenities(values: readonly string[]): AmenityKey[] {
  const seen = new Set<AmenityKey>()
  for (const v of values) if (isAmenityKey(v)) seen.add(v)
  // Se devuelve en el orden del catálogo, no en el de entrada: así todas las
  // unidades muestran sus íconos en la misma secuencia.
  return AMENITY_KEYS.filter((k) => seen.has(k))
}
