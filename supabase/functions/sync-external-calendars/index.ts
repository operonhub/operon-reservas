import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { normalizeIcalUrl } from "../_shared/ical-url.ts"

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
  // Soporta "20260901" (VALUE=DATE, lo típico de Airbnb/Booking) y
  // "20260901T000000Z" (por si acaso) -> siempre "2026-09-01".
  const digits = value.replace(/[^0-9]/g, "").slice(0, 8)
  if (digits.length !== 8) return null
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

// Un 200 no garantiza un calendario: cuando el link de exportación de
// Airbnb/Booking caduca o pide login, responden 200 con una página HTML.
function isIcalDocument(text: string): boolean {
  return /(^|[\r\n])BEGIN:VCALENDAR[\r\n]/.test(text) && /(^|[\r\n])END:VCALENDAR/.test(text)
}

function parseIcal(text: string): IcalEvent[] {
  const lines = unfoldLines(text)
  const events: IcalEvent[] = []
  let inEvent = false
  let uid: string | null = null
  let start: string | null = null
  let end: string | null = null

  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      inEvent = true
      uid = null
      start = null
      end = null
      continue
    }
    if (line.startsWith("END:VEVENT")) {
      if (inEvent && uid && start && end) {
        events.push({ uid, start_date: start, end_date: end })
      }
      inEvent = false
      continue
    }
    if (!inEvent) continue

    const idx = line.indexOf(":")
    if (idx < 0) continue
    const name = line.slice(0, idx)
    const value = line.slice(idx + 1).trim()

    if (name === "UID" || name.startsWith("UID;")) {
      uid = value
    } else if (name === "DTSTART" || name.startsWith("DTSTART;")) {
      start = parseIcalDate(value)
    } else if (name === "DTEND" || name.startsWith("DTEND;")) {
      end = parseIcalDate(value)
    }
  }
  return events
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

    const summary = await rpc<SyncSummary>("sync_unit_external_blocks", {
      p_worker_token: workerToken,
      p_unit_id: unitId,
      p_source: source,
      p_ranges: events,
      // Sólo un calendario válido y sin eventos (se cancelaron todas las
      // reservas en la plataforma) autoriza a liberar todo. Con eventos el
      // parámetro no se manda y la llamada queda idéntica a la anterior, así
      // que este worker funciona también contra una base sin la 0024.
      ...(events.length === 0 ? { p_allow_empty: true } : {}),
    })

    return { unit_id: unitId, source, ok: true, ...summary }
  } catch (error) {
    // Una URL rota/caída de un cliente no debe tumbar el sync de las demás.
    return {
      unit_id: unitId,
      source,
      ok: false,
      error: error instanceof Error ? error.message : "SYNC_FAILED",
    }
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
        .map((r) => ({ unit_id: r.unit_id, source: r.source, error: r.error })),
      totals,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "WORKER_FAILED" },
      { status: 500 }
    )
  }
})
