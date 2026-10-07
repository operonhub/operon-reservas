/**
 * Precio según la cantidad de personas (0040). Lógica pura: la usa la pantalla
 * de Tarifas para la vista previa y para validar antes de guardar. El cálculo
 * real lo hace la base (`_unit_price_night`); `applyGuestPrice` es su espejo y
 * hay un test que comprueba que den lo mismo.
 */

export type GuestPriceMode = "percent" | "fixed"
export type GuestTier = { guests: number; mode: GuestPriceMode; value: number }

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Precio de una noche para esa cantidad de personas.
 * `price`: lo que cuesta la noche antes del ajuste (base, temporada…).
 * `base`: el precio base de esa noche.
 */
export function applyGuestPrice(price: number, base: number | null, tier: GuestTier | undefined | null): number {
  if (!tier) return price
  if (tier.mode === "percent") return round2(price * (1 - tier.value / 100))
  // Precio fijo: el de una noche a tarifa base; con otro precio, la misma proporción.
  if (base == null || base === 0 || price === base) return tier.value
  return round2((price * tier.value) / base)
}

/** Cuánto cambia respecto del precio base, en porcentaje (negativo = más barato). */
export function tierChangePct(tier: GuestTier, base: number | null): number | null {
  if (tier.mode === "percent") return -tier.value
  if (base == null || base === 0) return null
  return round2((tier.value / base - 1) * 100)
}

export const peopleLabel = (n: number) => `${n} ${n === 1 ? "persona" : "personas"}`

/** "20% menos", "$ 90.000". */
export function describeTier(tier: GuestTier, money: (n: number) => string) {
  return tier.mode === "percent" ? `${tier.value}% menos` : money(tier.value)
}

/**
 * Lo que escribió el dueño en el casillero, como número. NaN si no se entiende.
 * Se escribe como en Argentina: en un precio fijo, "50000", "50.000" y "$ 50.000"
 * son lo mismo (el punto separa miles y la coma los decimales); en un porcentaje
 * el punto sí es decimal ("12.5" o "12,5").
 */
export function parseAmount(raw: string, mode: GuestPriceMode): number {
  let s = String(raw ?? "").trim().replace(/^\$\s*/, "").replace(/\s+/g, "")
  if (!s) return NaN
  if (mode === "fixed" && /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".")
  else s = s.replace(",", ".")
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

/** Un precio fijo de menos del 5% del precio base casi seguro es un cero que faltó (50 en vez de 50000). */
export function looksLikeMissingZeros(tier: GuestTier, base: number | null): boolean {
  return tier.mode === "fixed" && base != null && base > 0 && tier.value < base * 0.05
}

export type TierDraft = { guests: number; mode: "full" | GuestPriceMode; value: string }

/** Las filas del formulario: una por cantidad de personas, hasta la capacidad. */
export function draftsFor(capacity: number, tiers: GuestTier[]): TierDraft[] {
  return Array.from({ length: Math.max(0, capacity) }, (_, i) => {
    const tier = tiers.find((t) => t.guests === i + 1)
    return { guests: i + 1, mode: tier?.mode ?? "full", value: tier ? String(tier.value) : "" }
  })
}

/** Valida lo cargado y lo deja listo para guardar. Mismas reglas que la base. */
export function parseDrafts(drafts: TierDraft[], capacity: number): { tiers: GuestTier[] } | { error: string } {
  const tiers: GuestTier[] = []
  for (const d of drafts) {
    if (d.mode === "full") continue
    if (!Number.isInteger(d.guests) || d.guests < 1 || d.guests > capacity) return { error: "Cantidad de personas inválida." }
    const value = parseAmount(d.value, d.mode)
    const who = peopleLabel(d.guests)
    if (!Number.isFinite(value) || value <= 0) {
      return { error: d.mode === "percent" ? `Poné el porcentaje para ${who}.` : `Poné el precio para ${who}.` }
    }
    if (d.mode === "percent" && value >= 100) return { error: `El porcentaje para ${who} tiene que ser menor a 100.` }
    if (round2(value) !== value) return { error: `Usá como máximo dos decimales para ${who}.` }
    tiers.push({ guests: d.guests, mode: d.mode, value })
  }
  return { tiers }
}
