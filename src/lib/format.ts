/** Formato de moneda (por defecto ARS, sin decimales). */
export function formatCurrency(amount: number | null | undefined, currency = "ARS") {
  if (amount == null) return "—"
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** "2026-09-10" -> "10 sep". */
export function formatDay(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
  })
}

/** Fecha de hoy en formato YYYY-MM-DD (hora local). */
export function todayISO() {
  const d = new Date()
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tz).toISOString().slice(0, 10)
}

/** Suma n días a una fecha ISO (YYYY-MM-DD) y devuelve ISO. */
export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00")
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Cantidad de noches entre dos fechas ISO. */
export function nightsBetween(checkIn: string, checkOut: string) {
  const a = new Date(checkIn + "T00:00:00").getTime()
  const b = new Date(checkOut + "T00:00:00").getTime()
  return Math.round((b - a) / 86400000)
}
