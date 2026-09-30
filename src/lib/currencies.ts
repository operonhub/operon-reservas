/**
 * Monedas admitidas para la configuración de una propiedad.
 *
 * Solo pesos argentinos: se sacó dólares (2026-09-29) porque ningún complejo
 * cobra en otra moneda y la seña por Mercado Pago es en pesos. Sigue siendo
 * una lista (y la base acepta otros códigos) por si vuelve a hacer falta.
 * Lista cerrada a propósito: `formatCurrency` (Intl.NumberFormat) necesita un
 * código ISO 4217 válido, y con uno inventado los importes fallan al formatearse.
 */
export const CURRENCIES = [{ code: "ARS", label: "Pesos argentinos" }] as const

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code)

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODES.includes(value as (typeof CURRENCY_CODES)[number])
}
