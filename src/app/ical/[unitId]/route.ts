import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type IcalRange = { id: string; start_date: string; end_date: string }
type IcalFeed =
  | { found: false }
  | { found: true; unit_name: string; property_name: string; ranges: IcalRange[] }

function toIcalDate(iso: string): string {
  // "2026-08-20" -> "20260820" (evento de día completo, sin hora).
  return iso.replaceAll("-", "")
}

function foldLine(line: string): string {
  // RFC 5545: las líneas de más de 75 octetos se "pliegan" con un salto +
  // espacio. Nuestras líneas son cortas, pero lo dejamos por las dudas con
  // nombres de propiedad/unidad largos en el X-WR-CALNAME.
  if (line.length <= 75) return line
  let out = line.slice(0, 75)
  let rest = line.slice(75)
  while (rest.length > 0) {
    out += "\r\n " + rest.slice(0, 74)
    rest = rest.slice(74)
  }
  return out
}

function escapeText(text: string): string {
  return text.replace(/([,;\\])/g, "\\$1")
}

/**
 * Feed iCal público de una unidad: sólo rangos de fechas ocupadas (reservas +
 * bloqueos manuales, ya unificados en unit_occupancy). Pensado para que
 * Booking/Airbnb lo lean y bloqueen su calendario — sin datos de huéspedes,
 * precios ni motivos de bloqueo.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ unitId: string }> }
) {
  const { unitId } = await params
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("public_ical_feed", {
    p_unit_id: unitId,
  })
  const feed = data as IcalFeed | null

  if (error || !feed || !feed.found) {
    return new Response("No encontramos esa unidad.", { status: 404 })
  }

  const now =
    new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z")

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Operon Reservas//iCal Export//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(
      `X-WR-CALNAME:${escapeText(`${feed.property_name} - ${feed.unit_name}`)}`
    ),
  ]

  for (const r of feed.ranges) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@operon-reservas`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${toIcalDate(r.start_date)}`,
      `DTEND;VALUE=DATE:${toIcalDate(r.end_date)}`,
      "SUMMARY:Ocupado",
      "END:VEVENT"
    )
  }

  lines.push("END:VCALENDAR")

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendario.ics"',
      "Cache-Control": "public, max-age=1800", // 30' — Booking/Airbnb igual pollean cada tanto
    },
  })
}
