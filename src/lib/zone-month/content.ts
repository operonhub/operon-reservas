/** Nombre provisional: único punto de cambio para navegación y página. */
export const ZONE_MONTH_LABEL = "Tu zona este mes"
export const CLOSING = "¿Qué te gustaría profundizar el próximo mes: tarifas y números, conseguir reservas, turismo de la zona o gestión del alojamiento?"
export const TITLES = [
  "QUÉ SE VIENE EN TU ZONA", "SITUACIÓN Y OPORTUNIDAD", "TARIFAS Y DECISIÓN COMERCIAL",
  "MEJORA OPERATIVA O DE CONVERSIÓN", "PRÓXIMAS CUATRO SEMANAS",
] as const

// El modelo elige IDs, nunca redacta hechos, precios o diagnósticos libres.
// Este catálogo versionado hace que la validación semántica sea determinística.
export const PRACTICES = {
  conditions: { title: "Hacer claras las condiciones", text: "Revisar cómo se explican estadía mínima, cancelación y seña antes de ensayar una promoción. Sin datos comparables no corresponde recomendar subir o bajar precios.", effort: "bajo", signal: "Cantidad semanal de consultas sobre condiciones" },
  stay: { title: "Probar una propuesta de estadía", text: "Definir una propuesta de estadía con beneficios y condiciones explícitas. Evaluar consultas recibidas antes de modificar su alcance; no prometer demanda ni rentabilidad.", effort: "medio", signal: "Consultas por la propuesta y dudas sobre sus condiciones" },
  response: { title: "Preparar una respuesta breve", text: "Probar una respuesta a consultas que reúna condiciones y próximo paso. Es una práctica general, no una falla detectada en tu alojamiento.", effort: "bajo", signal: "Tiempo de respuesta y cantidad de repreguntas" },
  arrival: { title: "Preparar una guía de llegada", text: "Ensayar una lista clara de pasos para la llegada y revisarla con el equipo. Registrar dudas recurrentes sin guardar información personal.", effort: "medio", signal: "Cantidad de dudas sobre la llegada por semana" },
  interests: { title: "Empezar a registrar intereses", text: "Registrar en forma agregada qué actividades y duración de viaje se consultan. Usar esas señales para entender públicos del destino, sin asumir cómo rinde un alojamiento.", effort: "bajo", signal: "Conteo semanal de consultas por interés y duración" },
  agenda: { title: "Comprobar la agenda pública", text: "Revisar fechas y condiciones de acceso con el organismo turístico antes de comunicar una actividad. Si no hay confirmación, no anunciarla como evento.", effort: "bajo", signal: "Actividades con fecha y fuente oficial vigentes" },
  review: { title: "Revisar lo aprendido", text: "Reservar un momento al final de la cuarta semana para comparar los registros agregados y decidir qué práctica continuar.", effort: "medio", signal: "Una decisión documentada basada en los registros" },
} as const
export type PracticeId = keyof typeof PRACTICES
export type Fact = {
  id: string; kind: "holiday" | "event"; country: string; city: string | null;
  title: string; start: string; end: string; url: string; publisher: string;
  published: string; checked: string; validUntil: string; evidence: string;
}
export type Material = { version: 1; collectedAt: string; facts: Fact[]; warnings: string[] }
export type Selection = { version: 1; factIds: string[]; commercial: "conditions" | "stay"; operational: "response" | "arrival"; actions: PracticeId[] }
export type Edition = { version: 1; zone: string; month: string; material: Material; selection: Selection }
export const ERRORS: Record<string, string> = {
  missing_key: "Falta configurar la clave de generación.",
  quota: "La API no tiene cuota disponible. No se publicó contenido de reemplazo.",
  provider: "El proveedor de IA no pudo completar la edición.",
  invalid_output: "La respuesta de IA no pasó la validación. No se publicó.",
  invalid_sources: "La configuración de fuentes no pasó la validación.",
  timeout: "La generación excedió el tiempo disponible.",
  interrupted: "La generación fue interrumpida.",
}
export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`))
}

// ---------- Edición v2 (0037): investigación real del destino ----------
// La redacta Claude a partir de búsquedas web; cada dato fechado cita fuentes
// que salen de las citas reales de la búsqueda (índices en `sources`), nunca
// URLs escritas por el modelo. Las ediciones v1 se siguen mostrando.

export const INTERESTS = {
  tarifas: "Tarifas y números",
  reservas: "Conseguir reservas",
  turismo: "Turismo de la zona",
  gestion: "Gestión del alojamiento",
} as const
export type InterestId = keyof typeof INTERESTS

export const CALENDAR_KINDS = {
  feriado: "Feriado",
  finde_largo: "Fin de semana largo",
  vacaciones: "Vacaciones",
  temporada: "Temporada",
  otro: "Fecha clave",
} as const
export type CalendarKind = keyof typeof CALENDAR_KINDS

export type Source = { url: string; title: string }
export type PlaceScope = "localidad" | "departamento" | "provincia"
/** "a_confirmar": figura en una agenda oficial pero no se pudo verificar el año. */
export type EventStatus = "confirmado" | "a_confirmar"
export type ZoneEvent = {
  id: string; title: string; start: string; end: string; place: string | null;
  status: EventStatus; summary: string; forHosts: string; sources: number[];
}
export type CalendarItem = { kind: CalendarKind; title: string; start: string; end: string; summary: string; sources: number[] }
export type PracticalItem = { title: string; text: string; sources: number[] }
export type Idea = { title: string; text: string; eventId: string | null }
export type ReadyMessage = { eventId: string | null; channel: "whatsapp" | "instagram"; text: string }
export type EditionV2 = {
  version: 2; zone: string; month: string; collectedAt: string; model: string;
  place: { locality: string; department: string | null; province: string | null; scope: PlaceScope };
  headline: string; overview: string[];
  events: ZoneEvent[]; calendar: CalendarItem[]; practical: PracticalItem[];
  ideas: Idea[]; messages: ReadyMessage[]; sources: Source[];
}
/** Marcadores que el panel completa con los datos del complejo al copiar un mensaje. */
export const MESSAGE_PLACEHOLDERS = { name: "{alojamiento}", link: "{link}" } as const
