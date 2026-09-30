import "server-only"
import type { createClient } from "@/lib/supabase/server"
import { CALENDAR_KINDS, type EditionV2 } from "./content"

/**
 * "Tu complejo en {mes}": cruza las fechas de la edición con los datos del
 * complejo. Sin IA y sin guardar nada: se calcula al abrir la página, con el
 * cliente de la sesión (RLS) y el filtro explícito por organización.
 */

type Db = Awaited<ReturnType<typeof createClient>>
type Range = { start: string; end: string } // noches [start, end)

export type KeyDate = {
  key: string
  title: string
  label: string
  start: string
  end: string
  nights: number
  freeUnits: string[]
  totalUnits: number
  nightly: number | null
  normalNightly: number | null
  specialRate: boolean
}

export type PropertyMonth = {
  totalUnits: number
  nightsTotal: number
  nightsBooked: number
  pendingDeposit: number
  keyDates: KeyDate[]
  currency: string
  unitsForRates: { id: string; name: string }[]
  propertyId: string | null
}

const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const at = (d: string) => Date.parse(d + "T00:00:00Z")

export function monthBounds(month: string) {
  const first = new Date(month + "T00:00:00Z")
  const next = iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1))
  return { start: month, next }
}

/** "[2026-11-01,2026-11-05)" → noches del 1 al 4. */
export function parseRange(during: string): Range | null {
  const text = during.trim()
  const m = text.match(/^[[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})[)\]]$/)
  if (!m) return null
  const start = text.startsWith("(") ? iso(at(m[1]) + DAY) : m[1]
  const end = text.endsWith("]") ? iso(at(m[2]) + DAY) : m[2]
  return start < end ? { start, end } : null
}

const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end
const nightsIn = (r: Range) => Math.max(0, Math.round((at(r.end) - at(r.start)) / DAY))

/**
 * Noches de una fecha clave dentro del mes. Un evento del viernes al domingo
 * son las noches del viernes y el sábado; uno de un solo día, esa noche.
 */
export function stayFor(start: string, end: string, month: string): Range | null {
  const { start: first, next } = monthBounds(month)
  const from = start < first ? first : start
  const last = end > start ? end : iso(at(start) + DAY)
  const to = last > next ? next : last
  return from < to ? { start: from, end: to } : null
}

/** Primer martes del mes que no cae en ninguna fecha clave: el precio "de un día normal". */
export function referenceNight(month: string, busy: Range[]): Range | null {
  const { start, next } = monthBounds(month)
  for (let t = at(start); t < at(next); t += DAY) {
    const night = { start: iso(t), end: iso(t + DAY) }
    if (new Date(t).getUTCDay() === 2 && !busy.some(r => overlaps(r, night))) return night
  }
  return null
}

type Quote = { total: number | null; nights: number; breakdown: { rule: { kind?: string } | null }[] } | null

async function quote(db: Db, unit: string, range: Range, guests: number): Promise<Quote> {
  const { data, error } = await db.rpc("simulate_price", { p_unit: unit, p_check_in: range.start, p_check_out: range.end, p_guests: guests })
  if (error || !data || typeof data !== "object") return null
  const q = data as { total?: unknown; nights?: unknown; breakdown?: unknown }
  const total = q.total == null ? null : Number(q.total)
  return {
    total: total !== null && Number.isFinite(total) ? total : null,
    nights: Number(q.nights) || nightsIn(range),
    breakdown: Array.isArray(q.breakdown) ? q.breakdown as { rule: { kind?: string } | null }[] : [],
  }
}

export async function propertyMonth(db: Db, organizationId: string, edition: EditionV2): Promise<PropertyMonth> {
  const { start, next } = monthBounds(edition.month)
  const [{ data: units }, { data: occupancy }, { count: pending }, { data: property }] = await Promise.all([
    db.from("units").select("id, name, capacity").eq("organization_id", organizationId).eq("is_active", true).order("position"),
    db.from("unit_occupancy").select("unit_id, during").eq("organization_id", organizationId).overlaps("during", `[${start},${next})`),
    db.from("reservations").select("id", { count: "exact", head: true }).eq("organization_id", organizationId)
      .in("status", ["pending", "pending_payment"]).gte("check_in", start).lt("check_in", next),
    db.from("properties").select("id, currency").eq("organization_id", organizationId).order("created_at").limit(1).maybeSingle(),
  ])
  const list = units ?? []
  const busy = new Map<string, Range[]>()
  for (const o of occupancy ?? []) {
    const r = parseRange(String(o.during))
    if (!r) continue
    busy.set(o.unit_id, [...(busy.get(o.unit_id) ?? []), r])
  }
  const isFree = (unitId: string, stay: Range) => !(busy.get(unitId) ?? []).some(b => overlaps(b, stay))
  const monthRange = { start, end: next }
  const nightsTotal = list.length * nightsIn(monthRange)
  const nightsBooked = list.reduce((sum, u) => {
    const days = new Set<string>()
    for (const r of busy.get(u.id) ?? []) {
      for (let t = Math.max(at(r.start), at(start)); t < Math.min(at(r.end), at(next)); t += DAY) days.add(iso(t))
    }
    return sum + days.size
  }, 0)

  // Fechas clave: eventos y calendario, sin repetir el mismo rango.
  const candidates = [
    ...edition.events.map(e => ({ key: e.id, title: e.title, label: "Evento", start: e.start, end: e.end })),
    ...edition.calendar.map((c, i) => ({ key: `cal-${i}`, title: c.title, label: CALENDAR_KINDS[c.kind], start: c.start, end: c.end })),
  ]
  const seen = new Set<string>()
  const ranges = candidates
    .map(c => ({ ...c, stay: stayFor(c.start, c.end, edition.month) }))
    .filter((c): c is typeof c & { stay: Range } => c.stay !== null && nightsIn(c.stay) <= 16)
    .filter(c => { const k = c.stay.start + c.stay.end; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.stay.start.localeCompare(b.stay.start))
    .slice(0, 6)

  const priced = list[0]
  const guests = Math.max(1, Math.min(2, priced?.capacity ?? 2))
  const reference = referenceNight(edition.month, ranges.map(r => r.stay))
  const [normal, ...quotes] = await Promise.all([
    priced && reference ? quote(db, priced.id, reference, guests) : Promise.resolve(null),
    ...ranges.map(r => {
      const unit = list.find(u => isFree(u.id, r.stay)) ?? priced
      return unit ? quote(db, unit.id, r.stay, guests) : Promise.resolve(null)
    }),
  ])
  const normalNightly = normal?.total ? normal.total / normal.nights : null

  const keyDates: KeyDate[] = ranges.map((r, i) => {
    const q = quotes[i]
    return {
      key: r.key, title: r.title, label: r.label, start: r.stay.start, end: r.stay.end, nights: nightsIn(r.stay),
      freeUnits: list.filter(u => isFree(u.id, r.stay)).map(u => u.name),
      totalUnits: list.length,
      nightly: q?.total ? Math.round(q.total / q.nights) : null,
      normalNightly: normalNightly ? Math.round(normalNightly) : null,
      specialRate: Boolean(q?.breakdown.some(n => n.rule?.kind && n.rule.kind !== "base")),
    }
  })

  return {
    totalUnits: list.length, nightsTotal, nightsBooked, pendingDeposit: pending ?? 0, keyDates,
    currency: property?.currency ?? "ARS",
    unitsForRates: list.map(u => ({ id: u.id, name: u.name })),
    propertyId: property?.id ?? null,
  }
}
