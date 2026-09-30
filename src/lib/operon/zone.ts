/**
 * "Tu zona este mes" visto desde el panel de Operon (0034). Las ediciones son
 * por ciudad: la de un cliente la comparten todos los de su zona.
 */

export type ZoneEdition = {
  status: "pending" | "processing" | "failed" | "published"
  attempts: number
  error_code: string | null
  published_at: string | null
  started_at: string | null
}

export type ZoneOverview = {
  organization_id: string
  enabled_at: string | null
  missing_location: boolean
  zones: { zone: string; current: ZoneEdition | null; next: ZoneEdition | null }[]
}

export type Tone = "success" | "warning" | "danger" | "muted" | "info"

/** Mismo criterio que el worker: una generación de más de 5 minutos quedó colgada. */
function interrupted(edition: ZoneEdition, now: number) {
  return Boolean(edition.started_at && now - Date.parse(edition.started_at) > 5 * 60_000)
}

export function editionStatus(edition: ZoneEdition | null, now: number): { label: string; tone: Tone } {
  if (!edition) return { label: "Sin generar", tone: "muted" }
  if (edition.status === "published") return { label: "Publicada", tone: "success" }
  if (edition.status === "processing") {
    return interrupted(edition, now) ? { label: "Interrumpida", tone: "warning" } : { label: "Generando", tone: "info" }
  }
  if (edition.status === "failed") return { label: `Falló · intento ${edition.attempts} de 3`, tone: "danger" }
  return { label: "En cola", tone: "muted" }
}

/** Se puede pedir desde el panel: todo menos lo publicado o lo que se está generando ahora. */
export function canQueue(edition: ZoneEdition | null, now: number) {
  if (!edition) return true
  if (edition.status === "published") return false
  if (edition.status === "processing") return interrupted(edition, now)
  return true
}

/** Resumen de una línea para la columna del listado. */
export function overviewSummary(o: ZoneOverview | undefined, now: number): { label: string; tone: Tone } {
  if (!o?.enabled_at) return { label: "Desactivado", tone: "muted" }
  if (o.zones.length === 0) return { label: "Sin ciudad válida", tone: "warning" }
  const editions = o.zones.flatMap((z) => [z.current, z.next]).filter((e): e is ZoneEdition => e !== null)
  if (editions.some((e) => e.status === "failed")) return { label: "Con fallas", tone: "danger" }
  if (editions.some((e) => e.status === "processing" && !interrupted(e, now))) return { label: "Generando", tone: "info" }
  if (o.zones.every((z) => z.current?.status === "published")) return { label: "Al día", tone: "success" }
  return { label: "Activado", tone: "info" }
}

export function zoneLabel(zone: string) {
  const [country, city = ""] = zone.split(":")
  return `${city.replace(/(^|\s)\S/g, (part) => part.toLocaleUpperCase("es-AR"))} · ${country}`
}

export const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/30 text-warning-foreground",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
}
