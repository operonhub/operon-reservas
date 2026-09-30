import {
  CALENDAR_KINDS, type CalendarItem, type EditionV2, type Idea, type PlaceScope, type PracticalItem,
  type ReadyMessage, type Source, type ZoneEvent,
} from "./content"
import { GenerationError, validDate } from "./validation"

/**
 * Formato v2 de "Tu zona este mes". `normalizeEditionV2` limpia lo que devuelve
 * el modelo (recorta, descarta datos sin fuente o con fechas imposibles) y
 * `validateEditionV2` es la regla estricta: se aplica antes de publicar y cada
 * vez que el panel muestra una edición guardada.
 */

export const LIMITS = {
  headline: 160, paragraph: 900, overview: 4, title: 140, text: 700, place: 100,
  events: 12, calendar: 10, practical: 8, ideas: 6, messages: 6, sources: 40, sourceTitle: 200, url: 500,
} as const

type Json = Record<string, unknown>
const SCOPES: PlaceScope[] = ["localidad", "departamento", "provincia"]
const EVENT_ID = /^[a-z0-9-]{1,40}$/
// Caracteres de control: nunca en títulos; en mensajes se permite el salto de línea.
const CONTROL = /[\u0000-\u001F\u007F]/
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F]/

function check(ok: unknown): asserts ok { if (!ok) throw new GenerationError("invalid_output") }
function obj(value: unknown): Json {
  check(value && typeof value === "object" && !Array.isArray(value))
  return value as Json
}
function exact(value: Json, keys: string[]) {
  check(Object.keys(value).sort().join(",") === [...keys].sort().join(","))
}

/** Texto plano: sin HTML ni links sueltos (los links van solo en `sources`). */
export function isPlain(value: unknown, max: number, multiline = false): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max &&
    !/[<>]|https?:\/\/|www\./i.test(value) && !(multiline ? CONTROL_BUT_NEWLINE : CONTROL).test(value)
}

/** Recorta al máximo sin cortar palabras a la mitad cuando se puede. */
export function clip(value: unknown, max: number, multiline = false): string | null {
  if (typeof value !== "string") return null
  let text = value.replace(/<[^>]*>/g, "").replace(/https?:\/\/\S+|www\.\S+/gi, "")
  text = multiline ? text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ")
  text = text.replace(/[<>]/g, "").replace(new RegExp(CONTROL_BUT_NEWLINE.source, "g"), "").trim()
  if (!text) return null
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…"
}

/** Las fechas del dato tocan el mes, con una semana de margen a cada lado. */
export function withinMonth(start: string, end: string, month: string) {
  const first = new Date(month + "T00:00:00Z")
  const next = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)
  const week = 7 * 86400000
  return Date.parse(end + "T00:00:00Z") >= first.getTime() - week && Date.parse(start + "T00:00:00Z") < next + week
}

export function isSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > LIMITS.url) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".")
  } catch { return false }
}

function refs(value: unknown, count: number): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count))]
}

function item(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}
}

export type EditionMeta = {
  zone: string; month: string; collectedAt: string; model: string; sources: Source[];
  place: { locality: string; department: string | null; province: string | null };
}

/** Deja la salida del modelo lista para validar. Nunca inventa datos: solo quita o recorta. */
export function normalizeEditionV2(raw: unknown, meta: EditionMeta): EditionV2 {
  const r = obj(raw)
  const count = meta.sources.length
  const dated = <T extends { start: string; end: string; sources: number[] }>(x: T | null): x is T =>
    Boolean(x && validDate(x.start) && validDate(x.end) && x.start <= x.end &&
      withinMonth(x.start, x.end, meta.month) && x.sources.length > 0)

  const events = (Array.isArray(r.events) ? r.events : []).map((raw, i): ZoneEvent | null => {
    const x = item(raw)
    const title = clip(x.title, LIMITS.title)
    const summary = clip(x.summary, LIMITS.text)
    const forHosts = clip(x.forHosts, LIMITS.text)
    if (!title || !summary || !forHosts) return null
    const id = typeof x.id === "string" && EVENT_ID.test(x.id) ? x.id : `evento-${i + 1}`
    return { id, title, start: String(x.start ?? ""), end: String(x.end ?? x.start ?? ""),
      place: clip(x.place, LIMITS.place), summary, forHosts, sources: refs(x.sources, count) }
  }).filter(dated).filter((e, i, all) => all.findIndex(o => o.id === e.id) === i).slice(0, LIMITS.events)

  const calendar = (Array.isArray(r.calendar) ? r.calendar : []).map((raw): CalendarItem | null => {
    const x = item(raw)
    const title = clip(x.title, LIMITS.title)
    const summary = clip(x.summary, LIMITS.text)
    if (!title || !summary) return null
    const kind = typeof x.kind === "string" && Object.hasOwn(CALENDAR_KINDS, x.kind) ? x.kind as CalendarItem["kind"] : "otro"
    return { kind, title, start: String(x.start ?? ""), end: String(x.end ?? x.start ?? ""), summary, sources: refs(x.sources, count) }
  }).filter(dated).slice(0, LIMITS.calendar)

  const practical = (Array.isArray(r.practical) ? r.practical : []).map((raw): PracticalItem | null => {
    const x = item(raw)
    const title = clip(x.title, LIMITS.title)
    const text = clip(x.text, LIMITS.text)
    const sources = refs(x.sources, count)
    return title && text && sources.length ? { title, text, sources } : null
  }).filter((p): p is PracticalItem => p !== null).slice(0, LIMITS.practical)

  const eventIds = new Set(events.map(e => e.id))
  const linked = (value: unknown) => typeof value === "string" && eventIds.has(value) ? value : null

  const ideas = (Array.isArray(r.ideas) ? r.ideas : []).map((raw): Idea | null => {
    const x = item(raw)
    const title = clip(x.title, LIMITS.title)
    const text = clip(x.text, LIMITS.text)
    return title && text ? { title, text, eventId: linked(x.eventId) } : null
  }).filter((d): d is Idea => d !== null).slice(0, LIMITS.ideas)

  const messages = (Array.isArray(r.messages) ? r.messages : []).map((raw): ReadyMessage | null => {
    const x = item(raw)
    const text = clip(x.text, LIMITS.text, true)
    const channel = x.channel === "instagram" ? "instagram" : "whatsapp"
    return text ? { eventId: linked(x.eventId), channel, text } : null
  }).filter((m): m is ReadyMessage => m !== null).slice(0, LIMITS.messages)

  const overview = (Array.isArray(r.overview) ? r.overview : [])
    .map(p => clip(p, LIMITS.paragraph)).filter((p): p is string => p !== null).slice(0, LIMITS.overview)
  const scope = SCOPES.includes(r.scope as PlaceScope) ? r.scope as PlaceScope : "localidad"

  return {
    version: 2, zone: meta.zone, month: meta.month, collectedAt: meta.collectedAt, model: meta.model,
    place: {
      locality: clip(meta.place.locality, LIMITS.place) ?? meta.zone.split(":")[1],
      department: clip(meta.place.department, LIMITS.place),
      province: clip(meta.place.province, LIMITS.place),
      scope,
    },
    headline: clip(r.headline, LIMITS.headline) ?? "",
    overview, events, calendar, practical, ideas, messages,
    sources: meta.sources,
  }
}

/** Regla estricta. Lanza GenerationError("invalid_output") si algo no cumple. */
export function validateEditionV2(raw: unknown, zone: string, month: string): EditionV2 {
  const e = obj(raw)
  exact(e, ["version", "zone", "month", "collectedAt", "model", "place", "headline", "overview",
    "events", "calendar", "practical", "ideas", "messages", "sources"])
  check(e.version === 2 && e.zone === zone && e.month === month)
  check(typeof e.collectedAt === "string" && !Number.isNaN(Date.parse(e.collectedAt)))
  check(typeof e.model === "string" && /^claude-[a-z0-9.-]{1,60}$/.test(e.model))

  const place = obj(e.place)
  exact(place, ["locality", "department", "province", "scope"])
  check(isPlain(place.locality, LIMITS.place))
  check(place.department === null || isPlain(place.department, LIMITS.place))
  check(place.province === null || isPlain(place.province, LIMITS.place))
  check(SCOPES.includes(place.scope as PlaceScope))

  check(isPlain(e.headline, LIMITS.headline))
  check(Array.isArray(e.overview) && e.overview.length >= 1 && e.overview.length <= LIMITS.overview &&
    e.overview.every(p => isPlain(p, LIMITS.paragraph)))

  check(Array.isArray(e.sources) && e.sources.length <= LIMITS.sources)
  const sources = e.sources.map(s => {
    const x = obj(s)
    exact(x, ["url", "title"])
    check(isSourceUrl(x.url) && isPlain(x.title, LIMITS.sourceTitle))
    return x
  })
  check(new Set(sources.map(s => s.url)).size === sources.length)
  const cited = (value: unknown) => {
    check(Array.isArray(value) && value.length > 0 && new Set(value).size === value.length)
    check(value.every(n => Number.isInteger(n) && n >= 0 && n < sources.length))
  }
  const dated = (x: Json) => {
    check(validDate(x.start) && validDate(x.end) && (x.start as string) <= (x.end as string))
    check(withinMonth(x.start as string, x.end as string, month))
    cited(x.sources)
  }

  check(Array.isArray(e.events) && e.events.length <= LIMITS.events)
  const ids = new Set<string>()
  for (const raw of e.events) {
    const x = obj(raw)
    exact(x, ["id", "title", "start", "end", "place", "summary", "forHosts", "sources"])
    check(typeof x.id === "string" && EVENT_ID.test(x.id) && !ids.has(x.id)); ids.add(x.id as string)
    check(isPlain(x.title, LIMITS.title) && isPlain(x.summary, LIMITS.text) && isPlain(x.forHosts, LIMITS.text))
    check(x.place === null || isPlain(x.place, LIMITS.place))
    dated(x)
  }
  check(Array.isArray(e.calendar) && e.calendar.length <= LIMITS.calendar)
  for (const raw of e.calendar) {
    const x = obj(raw)
    exact(x, ["kind", "title", "start", "end", "summary", "sources"])
    check(typeof x.kind === "string" && Object.hasOwn(CALENDAR_KINDS, x.kind))
    check(isPlain(x.title, LIMITS.title) && isPlain(x.summary, LIMITS.text))
    dated(x)
  }
  check(Array.isArray(e.practical) && e.practical.length <= LIMITS.practical)
  for (const raw of e.practical) {
    const x = obj(raw)
    exact(x, ["title", "text", "sources"])
    check(isPlain(x.title, LIMITS.title) && isPlain(x.text, LIMITS.text))
    cited(x.sources)
  }
  const eventRef = (value: unknown) => check(value === null || (typeof value === "string" && ids.has(value)))
  check(Array.isArray(e.ideas) && e.ideas.length >= 1 && e.ideas.length <= LIMITS.ideas)
  for (const raw of e.ideas) {
    const x = obj(raw)
    exact(x, ["title", "text", "eventId"])
    check(isPlain(x.title, LIMITS.title) && isPlain(x.text, LIMITS.text))
    eventRef(x.eventId)
  }
  check(Array.isArray(e.messages) && e.messages.length <= LIMITS.messages)
  for (const raw of e.messages) {
    const x = obj(raw)
    exact(x, ["eventId", "channel", "text"])
    check(x.channel === "whatsapp" || x.channel === "instagram")
    check(isPlain(x.text, LIMITS.text, true))
    eventRef(x.eventId)
  }
  // Tiene que haber algo concreto del destino: agenda, calendario o info práctica.
  check(e.events.length + e.calendar.length + e.practical.length > 0)
  return e as unknown as EditionV2
}
