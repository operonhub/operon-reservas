/**
 * Salud de los calendarios de Airbnb/Booking de cada cliente (0035): lo que
 * reporta el sync de cada hora, traducido para el panel de Operon.
 */

export type IcalState = "ok" | "error" | "stale" | "pending" | "paused"

export type IcalStatusRow = {
  organization_id: string
  unit_id: string
  unit_name: string
  source: "airbnb" | "booking"
  state: IcalState
  last_ok_at: string | null
  last_error_at: string | null
  last_error: string | null
  failures: number
}

export const SOURCE_LABELS: Record<IcalStatusRow["source"], string> = { airbnb: "Airbnb", booking: "Booking" }

export const STATE_LABELS: Record<IcalState, string> = {
  ok: "Sincroniza bien",
  error: "Falla",
  stale: "Sin sincronizar hace horas",
  pending: "Todavía no sincronizó",
  paused: "Pausado (complejo suspendido)",
}

/** Lo que cuenta como problema: falló o dejó de sincronizar. */
export const isIcalProblem = (row: Pick<IcalStatusRow, "state">) => row.state === "error" || row.state === "stale"

/** Qué le pasa y qué tiene que hacer el cliente, en criollo. */
export function icalErrorLabel(code: string | null) {
  if (!code) return "No se pudo sincronizar."
  if (code === "HTTP_404" || code === "HTTP_410") {
    return "El link del calendario ya no existe: el cliente lo regeneró o lo borró en la plataforma. Tiene que copiar el nuevo."
  }
  if (code === "HTTP_401" || code === "HTTP_403") return "La plataforma rechaza el link. Hay que copiarlo de nuevo."
  if (code === "HTTP_429") return "La plataforma limitó las consultas. Suele resolverse solo."
  if (/^HTTP_5\d\d$/.test(code)) return "La plataforma no respondió bien. Suele resolverse solo."
  if (code.startsWith("HTTP_")) return `La plataforma respondió con un error (${code.slice(5)}).`
  if (code === "NOT_ICAL") return "El link no devuelve un calendario: puede estar vencido o pedir iniciar sesión."
  if (code === "INVALID_ICAL") return "El calendario contiene datos incompletos o que no se pudieron interpretar. Esta sincronización conservó las fechas anteriores."
  if (code.startsWith("BAD_URL_")) return "El link cargado no es válido."
  if (code.startsWith("REDIRECT_BLOCKED_") || code === "TOO_MANY_REDIRECTS") {
    return "El link redirige a un lugar no permitido."
  }
  if (code === "TIMEOUT") return "La plataforma tardó demasiado en responder."
  return "No se pudo sincronizar."
}

/**
 * Lo que necesita que alguien mire (0043): fechas importadas que la plataforma
 * dejó de informar y siguen bloqueadas por las dudas, y posibles sobreventas.
 */
export type IcalAttentionRow = {
  kind: "missing" | "conflict"
  /** El bloque, para poder liberarlo. Nulo en los choques. */
  id: string | null
  organization_id: string
  unit_id: string
  unit_name: string
  source: "airbnb" | "booking"
  desde: string
  hasta: string
  since: string | null
  missing_count: number
  hold_until: string | null
  /** Se libera sola si sigue faltando; si no, espera a que alguien la confirme. */
  auto_release: boolean
  other_kind: "reservation" | "airbnb" | "booking" | null
  other_desde: string | null
  other_hasta: string | null
  reservation_code: string | null
}

/** Una posible sobreventa es siempre un problema; una fecha en duda, no: está bloqueada. */
export const isIcalConflict = (row: Pick<IcalAttentionRow, "kind">) => row.kind === "conflict"

/** Con qué choca lo que la plataforma da por ocupado. */
export function conflictWith(row: Pick<IcalAttentionRow, "other_kind" | "reservation_code">) {
  if (row.other_kind === "reservation") return row.reservation_code ? `la reserva ${row.reservation_code}` : "una reserva del panel"
  if (row.other_kind === "airbnb" || row.other_kind === "booking") return `una fecha ocupada en ${SOURCE_LABELS[row.other_kind]}`
  return "otra ocupación"
}

/** Qué va a pasar con una fecha en duda, para decírselo a quien mira el panel. */
export function missingFate(row: Pick<IcalAttentionRow, "hold_until" | "auto_release">, now: number) {
  if (row.hold_until === "infinity") return "En espera: no se libera sola."
  if (row.hold_until && new Date(row.hold_until).getTime() > now) return "En espera: no se libera sola por ahora."
  if (!row.auto_release) return "Desaparecieron varias juntas: no se libera sola."
  return "Si sigue faltando, se libera sola a las 3 horas."
}
