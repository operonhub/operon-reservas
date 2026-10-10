import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { normalizeIcalUrl } from "../_shared/ical-url.ts"
import { errorCode, toReport } from "./sync-status.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
// A diferencia de notify-reservations (que usa la publishable key), acá las
// RPC están concedidas SOLO a service_role — no hay clave más débil posible.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_CONFIG_MISSING")
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`RPC_${name.toUpperCase()}_${response.status}: ${detail}`)
  }
  return (await response.json()) as T
}

type UnitRow = {
  unit_id: string
  organization_id: string
  airbnb_ical_url: string | null
  booking_ical_url: string | null
}

type IcalEvent = { uid: string; start_date: string; end_date: string }

type SyncSummary = {
  inserted: number
  updated: number
  removed: number
  skipped_conflicts: number
  /** El RPC no borró nada porque el feed vino vacío sin confirmación (0024). */
  empty_feed_ignored?: boolean
}

// ============================================================
// Parser mínimo de iCal (RFC 5545). No hace falta traer una librería para
// esto: sólo necesitamos UID/DTSTART/DTEND de cada VEVENT, nada más.
// ============================================================

function unfoldLines(text: string): string[] {
  // Una línea "plegada" empieza con espacio/tab y continúa la anterior.
  const raw = text.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

function parseIcalDate(value: string): string | null {
  // Conserva el día publicado: DATE, DATE-TIME local/TZID o UTC, sin
  // convertir la zona horaria. No rescatar dígitos de un valor ilegible.
  if (!/^\d{8}(?:T(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d|60)Z?)?$/i.test(value)) return null
  if (value.startsWith("0000")) return null
  const digits = value.slice(0, 8)
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  const date = new Date(`${iso}T00:00:00Z`)
  // Date normaliza, por ejemplo, el 30 de febrero: no es una fecha válida.
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso
}

// Un 200 no garantiza un calendario: cuando el link de exportación de
// Airbnb/Booking caduca o pide login, responden 200 con una página HTML.
function isIcalDocument(text: string): boolean {
  return /(^|[\r\n])BEGIN:VCALENDAR[\r\n]/i.test(text.replace(/^\uFEFF/, ""))
    && /(^|[\r\n])END:VCALENDAR(?:[\r\n]|$)/i.test(text)
}

// Componentes que sabemos interpretar o ignorar sin perder reservas. Un
// componente desconocido (p. ej. VEVENT mal escrito) no equivale a un feed vacío.
const ICAL_PARENT: Record<string, string | undefined> = {
  VEVENT: "VCALENDAR",
  VTIMEZONE: "VCALENDAR",
  STANDARD: "VTIMEZONE",
  DAYLIGHT: "VTIMEZONE",
  VALARM: "VEVENT",
}

/**
 * null significa que NO se puede usar ninguna parte de este calendario.
 * Omitir un VEVENT ilegible lo convertiría en una ausencia y podría liberar
 * sus fechas. Un calendario vacío válido, en cambio, devuelve [].
 * Sólo se admiten eventos con UID y un rango explícito de días DTSTART/DTEND.
 */
function parseIcal(text: string): IcalEvent[] | null {
  const lines = unfoldLines(text.replace(/^\uFEFF/, ""))
  const events: IcalEvent[] = []
  const byUid = new Map<string, IcalEvent>()
  const components: string[] = []
  let current: Partial<IcalEvent> | null = null
  let closed = false

  for (const line of lines) {
    if (!line) continue
    const idx = line.indexOf(":")
    if (idx < 0) return null
    const name = line.slice(0, idx)
    const property = name.split(";", 1)[0].toUpperCase()
    if (!/^[A-Z0-9-]+$/.test(property)) return null
    const value = line.slice(idx + 1).trim()
    const parent = components.at(-1)

    if (property === "BEGIN") {
      if (name.toUpperCase() !== "BEGIN" || closed) return null
      const component = value.toUpperCase()
      if (!/^[A-Z0-9-]+$/.test(component)) return null
      if (component === "VCALENDAR") {
        if (parent) return null
      } else if (!parent || ICAL_PARENT[component] !== parent) return null
      if (component === "VEVENT") {
        current = {}
      }
      components.push(component)
      continue
    }
    if (property === "END") {
      const component = value.toUpperCase()
      if (name.toUpperCase() !== "END" || !parent || parent !== component) return null
      if (component === "VEVENT") {
        const { uid, start_date, end_date } = current ?? {}
        if (!uid || !start_date || !end_date || end_date <= start_date) return null
        const previous = byUid.get(uid)
        // La base usa un solo rango por UID: dos rangos distintos con el
        // mismo UID perderían fechas al sincronizar. Una copia idéntica sí sirve.
        if (previous && (previous.start_date !== start_date || previous.end_date !== end_date)) return null
        if (!previous) {
          const event = { uid, start_date, end_date }
          events.push(event)
          byUid.set(uid, event)
        }
        current = null
      }
      components.pop()
      if (component === "VCALENDAR") closed = true
      continue
    }
    if (!parent) return null
    // Fechas sueltas en VCALENDAR pueden ser un evento que perdió sus
    // delimitadores: ignorarlas volvería a confundirlo con un feed vacío.
    if (parent === "VCALENDAR" && (property === "DTSTART" || property === "DTEND")) return null
    // VTIMEZONE y VALARM tienen sus propias fechas: no son las de la reserva.
    if (parent !== "VEVENT" || !current) continue
    // No expandimos recurrencias ni calculamos duraciones: aceptarlas y enviar
    // sólo DTSTART/DTEND sería otra lectura parcial. Las reglas de VTIMEZONE
    // quedan fuera de este control, porque no describen reservas.
    if (["RRULE", "RDATE", "EXDATE", "EXRULE", "RECURRENCE-ID", "DURATION"].includes(property)) return null

    if (property === "UID") {
      if (current.uid !== undefined || !value) return null
      current.uid = value
    } else if (property === "DTSTART" || property === "DTEND") {
      const key = property === "DTSTART" ? "start_date" : "end_date"
      const date = parseIcalDate(value)
      if (current[key] !== undefined || !date) return null
      current[key] = date
    }
  }
  return closed && components.length === 0 ? events : null
}

// ============================================================
// Sync por unidad/plataforma
// ============================================================

type PlatformResult = {
  unit_id: string
  source: "airbnb" | "booking"
  ok: boolean
  error?: string
} & Partial<SyncSummary>

/**
 * Descarga siguiendo las redirecciones a mano: cada salto se vuelve a
 * validar con normalizeIcalUrl. `fetch` con `redirect: "follow"` seguiría un
 * 302 a http://169.254.169.254 sin que lo veamos (auditoría B-03).
 */
async function fetchIcal(startUrl: string): Promise<Response> {
  let current = startUrl
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.1" },
    })
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get("location")
    if (!location) return res
    const next = normalizeIcalUrl(new URL(location, current).toString())
    if (!next.ok) throw new Error(`REDIRECT_BLOCKED_${next.reason}`)
    current = next.url
  }
  throw new Error("TOO_MANY_REDIRECTS")
}

async function syncPlatform(
  workerToken: string,
  unitId: string,
  source: "airbnb" | "booking",
  rawUrl: string
): Promise<PlatformResult> {
  try {
    const validated = normalizeIcalUrl(rawUrl)
    if (!validated.ok) {
      return { unit_id: unitId, source, ok: false, error: `BAD_URL_${validated.reason}` }
    }
    const res = await fetchIcal(validated.url)
    if (!res.ok) {
      return { unit_id: unitId, source, ok: false, error: `HTTP_${res.status}` }
    }
    const text = await res.text()
    // Tratar una página de error como "feed sin eventos" liberaba todas las
    // fechas importadas de la unidad (auditoría A-01).
    if (!isIcalDocument(text)) {
      return { unit_id: unitId, source, ok: false, error: "NOT_ICAL" }
    }
    const events = parseIcal(text)
    if (events === null) {
      return { unit_id: unitId, source, ok: false, error: "INVALID_ICAL" }
    }

    const summary = await rpc<SyncSummary>("sync_unit_external_blocks", {
      p_worker_token: workerToken,
      p_unit_id: unitId,
      p_source: source,
      p_ranges: events,
      // Sólo la lectura completa de un calendario realmente vacío permite
      // informar ausencias. La base sigue aplicando sus márgenes y esperas;
      // vacío no prueba que las reservas hayan sido canceladas.
      ...(events.length === 0 ? { p_allow_empty: true } : {}),
    })

    return { unit_id: unitId, source, ok: true, ...summary }
  } catch (error) {
    // Una URL rota/caída de un cliente no debe tumbar el sync de las demás.
    // Solo el código: el mensaje crudo puede traer el link con su token.
    return { unit_id: unitId, source, ok: false, error: errorCode(error) }
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 })
  }

  const workerToken = request.headers.get("x-worker-token") ?? ""

  try {
    const authorized = await rpc<boolean>("is_ical_sync_worker", {
      p_token: workerToken,
    })
    if (!authorized) {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }

    const units = await rpc<UnitRow[]>("list_units_for_ical_sync", {})

    const results: PlatformResult[] = []
    for (const unit of units) {
      if (unit.airbnb_ical_url) {
        results.push(
          await syncPlatform(workerToken, unit.unit_id, "airbnb", unit.airbnb_ical_url)
        )
      }
      if (unit.booking_ical_url) {
        results.push(
          await syncPlatform(workerToken, unit.unit_id, "booking", unit.booking_ical_url)
        )
      }
    }

    // El panel de Operon muestra estos resultados (0035). Si guardarlos falla,
    // el sync ya está hecho: no se tira abajo por eso.
    try {
      await rpc<number>("report_ical_sync_results", {
        p_worker_token: workerToken,
        p_results: toReport(results),
      })
    } catch {
      // Sin reporte esta corrida; la próxima lo vuelve a intentar.
    }

    const totals = results.reduce(
      (acc, r) => ({
        inserted: acc.inserted + (r.inserted ?? 0),
        updated: acc.updated + (r.updated ?? 0),
        removed: acc.removed + (r.removed ?? 0),
        skipped_conflicts: acc.skipped_conflicts + (r.skipped_conflicts ?? 0),
      }),
      { inserted: 0, updated: 0, removed: 0, skipped_conflicts: 0 }
    )

    return Response.json({
      units_processed: units.length,
      platforms_ok: results.filter((r) => r.ok).length,
      platforms_error: results.filter((r) => !r.ok).length,
      errors: results
        .filter((r) => !r.ok)
        .map((r) => ({ unit_id: r.unit_id, source: r.source, error: errorCode(r.error ?? "") })),
      totals,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "WORKER_FAILED" },
      { status: 500 }
    )
  }
})
