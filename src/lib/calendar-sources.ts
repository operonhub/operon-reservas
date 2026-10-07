/**
 * De dónde vienen los bloqueos importados de un calendario (0023): la
 * plataforma cuyo link pegó el dueño en la unidad.
 */
export type CalendarSource = "airbnb" | "booking"

export const CALENDAR_SOURCE_NAMES: Record<CalendarSource, string> = { airbnb: "Airbnb", booking: "Booking" }

/** Lo que dice la base en `external_source`, o null si el bloqueo se cargó a mano. */
export function asCalendarSource(value: unknown): CalendarSource | null {
  return value === "airbnb" || value === "booking" ? value : null
}

/** Cómo se llama en el calendario un bloqueo: su motivo, o de dónde viene, o "Bloqueo". */
export function blockLabel(reason: string | null | undefined, source: CalendarSource | null): string {
  const text = reason?.trim()
  if (text) return text
  return source ? `Reserva en ${CALENDAR_SOURCE_NAMES[source]}` : "Bloqueo"
}
