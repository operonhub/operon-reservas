import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { INTERESTS, monthLabel, type EditionV2, type Fact, type InterestId, type Source } from "./content"
import { GenerationError } from "./validation"
import { isSourceUrl, LIMITS, normalizeEditionV2, validateEditionV2 } from "./edition-v2"

/**
 * Investigación del destino con Claude, en dos pasos:
 *
 * 1. Investigar: Claude busca en la web y escribe un dossier. La API adjunta a
 *    cada frase las citas de la búsqueda; las convertimos en marcadores [n] y
 *    armamos NOSOTROS la lista de fuentes.
 * 2. Ordenar: otra llamada, sin búsqueda y con salida JSON estricta, pasa el
 *    dossier al formato del informe. Solo puede citar números de esa lista, así
 *    que ningún link del informe sale de la imaginación del modelo.
 *
 * Solo viaja información pública: localidad, departamento, provincia, mes,
 * feriados curados y la cuenta agregada de intereses. Nada de alojamientos.
 */

export const DEFAULT_MODEL = "claude-sonnet-5-5"
const MAX_SEARCHES = 10
const RESEARCH_TIMEOUT_MS = 180_000
const WRITE_TIMEOUT_MS = 90_000

export function researchModel() {
  const model = process.env.ZONE_MODEL || DEFAULT_MODEL
  if (!/^claude-[a-z0-9.-]{1,60}$/.test(model)) throw new GenerationError("provider")
  return model
}

export type ResearchInput = {
  zone: string
  month: string
  place: { locality: string; department: string | null; province: string | null }
  facts: Fact[]
  interests: Partial<Record<InterestId, number>>
  /** AAAA-MM-DD: para que el modelo juzgue qué información es reciente. */
  today: string
}

export type Dossier = { text: string; sources: Source[]; searches: number }

type Usage = { input: number; output: number; searches: number }

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new GenerationError("missing_key")
  return new Anthropic({ apiKey, maxRetries: 1 })
}

/** Errores del SDK a los códigos que ya muestra el panel. */
function providerError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new GenerationError("missing_key")
  if (error instanceof Anthropic.RateLimitError) return new GenerationError("quota")
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new GenerationError("timeout")
  return new GenerationError("provider")
}

function placeLine(place: ResearchInput["place"]) {
  return [
    `Localidad: ${place.locality}`,
    place.department ? `Departamento o partido: ${place.department}` : null,
    place.province ? `Provincia: ${place.province}` : null,
  ].filter(Boolean).join("\n")
}

function monthRange(month: string) {
  const first = new Date(month + "T00:00:00Z")
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
  return `${month} al ${last.toISOString().slice(0, 10)}`
}

const RESEARCH_SYSTEM = `Sos investigador de turismo para dueños de alojamientos chicos (cabañas, complejos, posadas) en Argentina. Tu trabajo es averiguar qué va a pasar en un destino durante un mes, para que el dueño pueda aprovecharlo.

Reglas:
- Informá solo lo que respaldan los resultados de búsqueda. Si no encontrás algo, decilo ("No encontré agenda publicada para…"). Nunca completes con suposiciones.
- Toda fecha tiene que ser exacta (día, mes y año). Si una fuente no da la fecha exacta, aclaralo.
- Cuidado con las agendas que agrupan eventos bajo títulos de mes ("Octubre", "Noviembre"): no asumas que todo lo de la página es del mes que buscás. Confirmá cada evento con su propia búsqueda (nombre del evento, localidad y año) y descartá el que no puedas confirmar en el mes y el año pedidos.
- Fijate el año: una página puede ser de la edición anterior. Si no queda claro que la fecha es de este año, no la des por confirmada.
- Información práctica (rutas, obras, transporte, servicios): solo novedades publicadas en el último mes o que anuncien algo para el mes pedido. Descartá reportes viejos.
- Priorizá fuentes oficiales (municipio, secretaría o ente de turismo provincial, argentina.gob.ar) y medios locales. Descartá resultados de lugares con el mismo nombre en otra provincia.
- Si del pueblo hay poca información, ampliá al departamento o partido, y si hace falta a la provincia; decí explícitamente a qué nivel corresponde cada dato.
- No inventes precios, ocupación ni estadísticas.
- Escribí en español rioplatense, en texto plano, sin links.`

function researchPrompt(input: ResearchInput) {
  const interests = Object.entries(input.interests).filter(([, n]) => (n ?? 0) > 0)
    .map(([id, n]) => `${INTERESTS[id as InterestId]} (${n})`)
  const facts = input.facts.map(f => `- ${f.title}: ${f.start}${f.end !== f.start ? ` al ${f.end}` : ""} (${f.publisher})`)
  return `Destino a investigar:
${placeLine(input.place)}
País: Argentina
Mes: ${monthLabel(input.month)} (${monthRange(input.month)})
Hoy es ${input.today}.

${facts.length ? `Fechas ya confirmadas por fuentes oficiales (no hace falta buscarlas):\n${facts.join("\n")}\n\n` : ""}${interests.length ? `Los dueños de la zona pidieron profundizar en: ${interests.join(", ")}.\n\n` : ""}Buscá en la web y escribí un dossier con estas secciones:

1. Panorama del mes: qué temporada es, clima típico (temperaturas promedio y lluvias de ese mes en la zona) y qué buscan los turistas que llegan en esa época.
2. Agenda: fiestas, festivales, eventos deportivos, culturales o religiosos del mes en la localidad y alrededores, con fecha exacta y lugar.
3. Calendario: feriados y fines de semana largos del mes en Argentina, y vacaciones escolares de las provincias desde donde suelen llegar turistas a este destino, si caen en el mes.
4. Información práctica: estado de rutas y accesos, obras, transporte, servicios o cambios que afecten al turista ese mes.
5. Para el alojamiento: qué conviene preparar o comunicar según lo anterior.

Usá como máximo ${MAX_SEARCHES} búsquedas.`
}

/**
 * Paso 1. Devuelve el dossier con marcadores [n] y la lista de fuentes que salen
 * de las citas reales de la búsqueda (más los feriados curados).
 */
export async function researchDossier(input: ResearchInput, model: string, usage: Usage): Promise<Dossier> {
  const api = client()
  const sources: Source[] = []
  const indexOf = (url: string, title: string) => {
    const found = sources.findIndex(s => s.url === url)
    if (found >= 0) return found
    if (sources.length >= LIMITS.sources) return -1
    sources.push({ url, title: title.replace(/\s+/g, " ").trim().slice(0, LIMITS.sourceTitle) || new URL(url).hostname })
    return sources.length - 1
  }

  // Los feriados curados entran como fuentes verificadas desde el principio.
  const confirmed = input.facts.map(f => `- ${f.title}: ${f.start}${f.end !== f.start ? ` al ${f.end}` : ""} [${indexOf(f.url, f.publisher)}]`)

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: researchPrompt(input) }]
  const parts: string[] = []
  const location = {
    type: "approximate" as const,
    country: "AR",
    city: input.place.locality,
    ...(input.place.province ? { region: input.place.province } : {}),
    timezone: "America/Argentina/Buenos_Aires",
  }

  try {
    // Una búsqueda larga puede pausarse (pause_turn): se reenvía el turno tal cual.
    for (let round = 0; round < 4; round++) {
      const response = await api.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: RESEARCH_SYSTEM,
        messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES, user_location: location }],
      }, { timeout: RESEARCH_TIMEOUT_MS })

      usage.input += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0)
      usage.output += response.usage.output_tokens
      usage.searches += response.usage.server_tool_use?.web_search_requests ?? 0
      if (response.stop_reason === "refusal") throw new GenerationError("provider")

      for (const block of response.content) {
        if (block.type !== "text") continue
        const marks = new Set<number>()
        for (const citation of block.citations ?? []) {
          if (citation.type !== "web_search_result_location" || !isSourceUrl(citation.url)) continue
          const n = indexOf(citation.url, citation.title ?? "")
          if (n >= 0) marks.add(n)
        }
        parts.push(block.text + (marks.size ? " " + [...marks].map(n => `[${n}]`).join("") : ""))
      }
      if (response.stop_reason !== "pause_turn") {
        if (response.stop_reason === "max_tokens") throw new GenerationError("invalid_output")
        break
      }
      messages.push({ role: "assistant", content: response.content })
      if (round === 3) throw new GenerationError("timeout")
    }
  } catch (error) {
    throw providerError(error)
  }

  const text = parts.join("").trim()
  // Sin ninguna cita de la web no hay informe verificable.
  if (!text || sources.length <= input.facts.length) throw new GenerationError("invalid_output")
  const header = confirmed.length ? `Fechas confirmadas por fuentes oficiales:\n${confirmed.join("\n")}\n\n` : ""
  return { text: header + text, sources, searches: usage.searches }
}

const WRITE_SYSTEM = `Convertís un dossier de investigación turística en el informe mensual para el dueño de un alojamiento chico en Argentina.

Reglas:
- Usá SOLO información del dossier. No agregues datos, fechas, lugares ni links.
- Los números entre corchetes [n] del dossier identifican fuentes. Todo evento, fecha del calendario o dato práctico lleva en "sources" los números [n] de las frases de donde sale. Si un dato no tiene número, no lo incluyas.
- Fechas en formato AAAA-MM-DD. Si el dossier no da el día exacto, no lo pongas en events ni en calendar.
- "scope": "localidad" si la mayoría de los datos son del pueblo; "departamento" o "provincia" si hubo que ampliar.
- "headline": una frase que resuma el mes para el alojamiento. "overview": 2 o 3 párrafos cortos sobre el destino ese mes: temporada, clima, qué busca el turista y qué fechas concentran el movimiento.
- El panorama habla del destino, no de la investigación: no escribas "no se encontró", "según lo encontrado" ni menciones informes, sitios o fuentes. Si falta un dato, omitilo. Solo si "scope" no es "localidad", agregá una oración breve aclarando que parte de la información es del departamento o la provincia.
- "status" de cada evento: "confirmado" si el dossier lo da por confirmado con fecha y año; "a_confirmar" si figura en una agenda oficial (municipio o ente de turismo) pero no se pudo verificar el año. Si el dossier dice que es de otro mes o de otro año, no lo incluyas.
- No menciones en el panorama eventos que no estén en "events".
- Los mensajes solo pueden promocionar eventos "confirmado".
- "forHosts" de cada evento: qué significa para un alojamiento (qué público llega, qué preparar, cuándo publicarlo).
- "ideas": 3 a 5 acciones concretas para el alojamiento ese mes (estadía mínima, paquetes, horarios, comunicación con huéspedes anteriores), con "eventId" cuando se ligan a un evento.
- "messages": 2 a 4 textos breves listos para mandar por WhatsApp o publicar en Instagram, en primera persona del alojamiento. Usá {alojamiento} para el nombre y {link} para el link de reservas. Sin emojis de más.
- Español rioplatense, claro, concreto y amable. Sin links ni HTML en los textos.`

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] }
const sourceList = { type: "array", items: { type: "integer" } }
const WRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "overview", "scope", "events", "calendar", "practical", "ideas", "messages"],
  properties: {
    headline: { type: "string" },
    overview: { type: "array", items: { type: "string" } },
    scope: { type: "string", enum: ["localidad", "departamento", "provincia"] },
    events: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["id", "title", "start", "end", "place", "status", "summary", "forHosts", "sources"],
      properties: {
        id: { type: "string", description: "minúsculas y guiones, por ejemplo fiesta-del-chocolate" },
        title: { type: "string" }, start: { type: "string" }, end: { type: "string" },
        status: { type: "string", enum: ["confirmado", "a_confirmar"] },
        place: nullableString, summary: { type: "string" }, forHosts: { type: "string" }, sources: sourceList,
      },
    } },
    calendar: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["kind", "title", "start", "end", "summary", "sources"],
      properties: {
        kind: { type: "string", enum: ["feriado", "finde_largo", "vacaciones", "temporada", "otro"] },
        title: { type: "string" }, start: { type: "string" }, end: { type: "string" },
        summary: { type: "string" }, sources: sourceList,
      },
    } },
    practical: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["title", "text", "sources"],
      properties: { title: { type: "string" }, text: { type: "string" }, sources: sourceList },
    } },
    ideas: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["title", "text", "eventId"],
      properties: { title: { type: "string" }, text: { type: "string" }, eventId: nullableString },
    } },
    messages: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["eventId", "channel", "text"],
      properties: { eventId: nullableString, channel: { type: "string", enum: ["whatsapp", "instagram"] }, text: { type: "string" } },
    } },
  },
}

/** Paso 2. Pasa el dossier al formato del informe y lo valida. */
export async function writeEdition(input: ResearchInput, dossier: Dossier, model: string, usage: Usage, now: Date): Promise<EditionV2> {
  const api = client()
  const sourceList = dossier.sources.map((s, i) => `[${i}] ${s.title}`).join("\n")
  let raw: unknown
  try {
    const response = await api.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: WRITE_SCHEMA } },
      system: WRITE_SYSTEM,
      messages: [{
        role: "user",
        content: `${placeLine(input.place)}\nMes: ${monthLabel(input.month)} (${monthRange(input.month)})\n\nFuentes:\n${sourceList}\n\nDossier:\n${dossier.text}`,
      }],
    }, { timeout: WRITE_TIMEOUT_MS })
    usage.input += response.usage.input_tokens
    usage.output += response.usage.output_tokens
    if (response.stop_reason !== "end_turn") throw new GenerationError(response.stop_reason === "refusal" ? "provider" : "invalid_output")
    const text = response.content.find(b => b.type === "text")
    if (!text || text.type !== "text") throw new GenerationError("invalid_output")
    raw = JSON.parse(text.text)
  } catch (error) {
    if (error instanceof SyntaxError) throw new GenerationError("invalid_output")
    throw providerError(error)
  }

  const edition = normalizeEditionV2(raw, {
    zone: input.zone, month: input.month, collectedAt: now.toISOString(), model,
    sources: dossier.sources, place: input.place,
  })
  // Solo quedan las fuentes que el informe cita, renumeradas.
  return validateEditionV2(pruneSources(edition), input.zone, input.month)
}

/** Quita de la lista las fuentes que ningún dato usa y renumera las referencias. */
export function pruneSources(edition: EditionV2): EditionV2 {
  const used = [...new Set([...edition.events, ...edition.calendar, ...edition.practical].flatMap(x => x.sources))].sort((a, b) => a - b)
  const map = new Map(used.map((old, i) => [old, i]))
  const remap = (list: number[]) => list.map(n => map.get(n)!)
  return {
    ...edition,
    events: edition.events.map(e => ({ ...e, sources: remap(e.sources) })),
    calendar: edition.calendar.map(c => ({ ...c, sources: remap(c.sources) })),
    practical: edition.practical.map(p => ({ ...p, sources: remap(p.sources) })),
    sources: used.map(n => edition.sources[n]),
  }
}

/** Los dos pasos. `usage` queda con los tokens y búsquedas reales, para medir el costo. */
export async function researchZone(input: ResearchInput, now = new Date()) {
  const model = researchModel()
  const usage: Usage = { input: 0, output: 0, searches: 0 }
  const dossier = await researchDossier(input, model, usage)
  const edition = await writeEdition(input, dossier, model, usage, now)
  return { edition, dossier, usage, model }
}
