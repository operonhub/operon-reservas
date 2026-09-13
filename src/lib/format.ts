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

/**
 * Huso de los alojamientos: el mismo default que `properties.timezone`
 * (0001). Ninguna pantalla permite cambiarlo todavía, así que hoy es el de
 * todas las propiedades.
 */
export const DEFAULT_TIMEZONE = "America/Argentina/Cordoba"

/**
 * Fecha de hoy (YYYY-MM-DD) en el huso del alojamiento, no en el del proceso.
 * En Vercel el servidor corre en UTC: con `getTimezoneOffset()` el panel
 * pasaba al día siguiente a las 21:00 de Argentina (auditoría M-04), y el
 * servidor y el navegador podían no coincidir sobre qué día era.
 */
export function todayISO(timeZone: string = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

/** Suma n días a una fecha ISO (YYYY-MM-DD) y devuelve ISO. */
export function addDays(iso: string, n: number) {
  // En UTC de punta a punta. Con la hora local, en un navegador al este de
  // UTC (un huésped en Europa) la medianoche local cae el día anterior en UTC
  // y el resultado salía corrido un día.
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Primer día del mes de una fecha ISO. */
export function startOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`
}

/**
 * Suma n meses al primer día del mes de una fecha ISO.
 * Siempre devuelve un día 1, así que no hay que preocuparse por el
 * desborde de meses cortos (31 de enero + 1 mes).
 */
export function addMonths(iso: string, n: number) {
  const [y, m] = iso.split("-").map(Number)
  const total = y * 12 + (m - 1) + n
  const year = Math.floor(total / 12)
  const month = total % 12
  return `${year}-${String(month + 1).padStart(2, "0")}-01`
}

/** Cantidad de noches entre dos fechas ISO. */
export function nightsBetween(checkIn: string, checkOut: string) {
  const a = new Date(checkIn + "T00:00:00").getTime()
  const b = new Date(checkOut + "T00:00:00").getTime()
  return Math.round((b - a) / 86400000)
}

/** Link de WhatsApp a partir de un teléfono en cualquier formato. */
export function whatsappHref(rawPhone: string) {
  return `https://wa.me/${rawPhone.replace(/\D/g, "")}`
}

/** Iniciales para el avatar: "Tomás Cieri" -> "TC". */
export function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}
