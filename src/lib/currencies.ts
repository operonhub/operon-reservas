/**
 * Monedas admitidas para la configuración de una propiedad.
 *
 * Solo pesos y dólares: son las dos con las que cobran los alojamientos en
 * Argentina. Lista cerrada a propósito: `formatCurrency` (Intl.NumberFormat)
 * necesita un código ISO 4217 válido, y con uno inventado los importes de
 * toda la app fallan al formatearse.
 */
export const CURRENCIES = [
  { code: "ARS", label: "Pesos argentinos" },
  { code: "USD", label: "Dólares" },
] as const

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code)

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODES.includes(value as (typeof CURRENCY_CODES)[number])
}
