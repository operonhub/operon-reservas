/**
 * Monedas admitidas para la configuración de una propiedad.
 *
 * Lista cerrada a propósito: el campo era texto libre de 3 caracteres y
 * aceptaba cualquier cosa, pero después `formatCurrency` (Intl.NumberFormat)
 * necesita un código ISO 4217 válido — con uno inventado, los importes de
 * toda la app fallan al formatearse.
 */
export const CURRENCIES = [
  { code: "ARS", label: "Peso argentino" },
  { code: "USD", label: "Dólar estadounidense" },
  { code: "EUR", label: "Euro" },
  { code: "BRL", label: "Real brasileño" },
  { code: "CLP", label: "Peso chileno" },
  { code: "UYU", label: "Peso uruguayo" },
  { code: "PYG", label: "Guaraní" },
] as const

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code)

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODES.includes(value as (typeof CURRENCY_CODES)[number])
}
