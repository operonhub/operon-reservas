/**
 * Formato compartido por las páginas del panel interno de Operon.
 * `now` siempre llega de afuera: la regla de pureza de React no deja leer el
 * reloj directo en el render.
 */

const DAY = 86_400_000
const relativeTime = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" })

export function daysSince(iso: string | null | undefined, now: number) {
  return iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : Infinity
}

export function relative(iso: string, now: number) {
  const days = (new Date(iso).getTime() - now) / DAY
  if (Math.abs(days) < 1) {
    const hours = Math.round(days * 24)
    return hours === 0 ? "recién" : relativeTime.format(hours, "hour")
  }
  if (Math.abs(days) < 30) return relativeTime.format(Math.round(days), "day")
  return relativeTime.format(Math.round(days / 30), "month")
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  })
}

export type Activity = { label: string; dot: string; days: number }

/**
 * `last_sign_in_at` cuenta inicios de sesión, no uso: una sesión abierta se
 * renueva sola y no lo actualiza. Por eso "activo" también mira la última
 * reserva cargada, y la etiqueta habla de ingresos, no de "uso".
 */
export function activity(
  client: { last_sign_in_at: string | null; last_reservation_at: string | null },
  now: number
): Activity {
  const days = Math.min(daysSince(client.last_sign_in_at, now), daysSince(client.last_reservation_at, now))
  if (days === Infinity) return { label: "Sin actividad", dot: "bg-muted-foreground/40", days }
  if (days <= 7) return { label: "Activo", dot: "bg-success", days }
  if (days <= 30) return { label: "Poco activo", dot: "bg-warning", days }
  return { label: "Inactivo", dot: "bg-destructive", days }
}
