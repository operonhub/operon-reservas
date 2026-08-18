import {
  Sun, CalendarRange, Percent, CalendarClock, Users, Sparkles, Tag,
  type LucideIcon,
} from "lucide-react"
import type { Enums } from "@/lib/supabase/types"

/**
 * Presets de reglas de tarifa.
 *
 * La base guarda condiciones sueltas (fechas, días de la semana, huéspedes,
 * noches). Estos presets son el vocabulario del propietario — "fin de semana",
 * "exclusivo parejas" — y definen qué condiciones rellenar y qué campos
 * mostrar en el formulario. Así el diálogo no es una planilla con todos los
 * campos siempre visibles.
 */
export type RulePreset =
  | "base"
  | "temporada"
  | "finde"
  | "descuento"
  | "estadia_larga"
  | "huespedes"
  | "especial"

/** Qué campos muestra el formulario para cada preset. */
export type RuleField =
  | "price"
  | "discount"
  | "dates"
  | "weekdays"
  | "guests"
  | "minNightsRule"
  | "minNights"

type PresetDef = {
  label: string
  hint: string
  icon: LucideIcon
  /** `kind` con el que se guarda en la base. */
  kind: Enums<"rate_kind">
  fields: RuleField[]
  /** Días preseleccionados (0=domingo). */
  defaultWeekdays?: number[]
  className: string
}

export const RULE_PRESETS: Record<RulePreset, PresetDef> = {
  base: {
    label: "Precio base",
    hint: "El precio de referencia de la unidad. Todas las demás reglas se calculan sobre este.",
    icon: Tag,
    kind: "base",
    fields: ["price", "minNights"],
    className: "bg-secondary text-secondary-foreground",
  },
  temporada: {
    label: "Temporada",
    hint: "Un precio distinto durante un período: verano, vacaciones de invierno, Semana Santa.",
    icon: Sun,
    kind: "seasonal",
    fields: ["price", "dates", "minNights"],
    className: "bg-warning/30 text-foreground",
  },
  finde: {
    label: "Fin de semana",
    hint: "Precio distinto según el día. Por defecto viernes y sábado.",
    icon: CalendarRange,
    kind: "seasonal",
    fields: ["price", "weekdays", "dates"],
    defaultWeekdays: [5, 6],
    className: "bg-primary/15 text-foreground",
  },
  descuento: {
    label: "Descuento",
    hint: "Un porcentaje de rebaja sobre el precio base durante un período.",
    icon: Percent,
    kind: "special",
    fields: ["discount", "dates"],
    className: "bg-success/20 text-foreground",
  },
  estadia_larga: {
    label: "Estadía larga",
    hint: "Rebaja a partir de cierta cantidad de noches. Sirve para llenar semanas completas.",
    icon: CalendarClock,
    kind: "special",
    fields: ["discount", "minNightsRule"],
    className: "bg-success/20 text-foreground",
  },
  huespedes: {
    label: "Según huéspedes",
    hint: "Aplica solo a grupos de cierto tamaño. El clásico “exclusivo parejas”.",
    icon: Users,
    kind: "special",
    fields: ["price", "discount", "guests", "dates"],
    className: "bg-accent text-accent-foreground",
  },
  especial: {
    label: "Fecha especial",
    hint: "Días puntuales con precio propio: Año Nuevo, un fin de semana largo.",
    icon: Sparkles,
    kind: "special",
    fields: ["price", "dates"],
    className: "bg-warning/30 text-foreground",
  },
}

export const PRESET_KEYS = Object.keys(RULE_PRESETS) as RulePreset[]

/** Presets que el propietario puede crear (base se edita aparte). */
export const CREATABLE_PRESETS = PRESET_KEYS.filter((k) => k !== "base")

export const WEEKDAYS = [
  { value: 0, short: "D", label: "domingo" },
  { value: 1, short: "L", label: "lunes" },
  { value: 2, short: "M", label: "martes" },
  { value: 3, short: "M", label: "miércoles" },
  { value: 4, short: "J", label: "jueves" },
  { value: 5, short: "V", label: "viernes" },
  { value: 6, short: "S", label: "sábado" },
]

export type RateRow = {
  id: string
  unit_id: string | null
  kind: Enums<"rate_kind">
  label: string | null
  price_per_night: number | null
  discount_pct: number | null
  weekdays: number[] | null
  min_guests: number | null
  max_guests: number | null
  min_nights: number
  min_nights_rule: number | null
  priority: number
  start_date: string | null
  end_date: string | null
  is_active: boolean
  currency: string | null
}

/**
 * Deduce qué preset representa una fila guardada. La base no almacena el
 * preset: se infiere de las condiciones, para no agregar una columna que
 * pueda quedar desincronizada del contenido real.
 */
export function presetOf(rate: RateRow): RulePreset {
  if (rate.kind === "base") return "base"
  if (rate.weekdays?.length) return "finde"
  if (rate.min_nights_rule) return "estadia_larga"
  if (rate.min_guests != null || rate.max_guests != null) return "huespedes"
  if (rate.discount_pct != null) return "descuento"
  if (rate.kind === "seasonal") return "temporada"
  return "especial"
}

/** Frase en castellano que explica cuándo aplica la regla. */
export function describeRule(rate: RateRow): string {
  const parts: string[] = []

  if (rate.weekdays?.length) {
    const names = rate.weekdays
      .slice()
      .sort()
      .map((d) => WEEKDAYS[d]?.label ?? "")
      .filter(Boolean)
    parts.push(names.length === 7 ? "todos los días" : names.join(", "))
  }
  if (rate.start_date && rate.end_date) {
    parts.push(`del ${rate.start_date} al ${rate.end_date}`)
  }
  if (rate.min_nights_rule) {
    parts.push(`desde ${rate.min_nights_rule} noches`)
  }
  if (rate.min_guests != null && rate.max_guests != null) {
    parts.push(
      rate.min_guests === rate.max_guests
        ? `para ${rate.min_guests} huéspedes`
        : `de ${rate.min_guests} a ${rate.max_guests} huéspedes`
    )
  } else if (rate.max_guests != null) {
    parts.push(`hasta ${rate.max_guests} huéspedes`)
  } else if (rate.min_guests != null) {
    parts.push(`desde ${rate.min_guests} huéspedes`)
  }

  return parts.length ? parts.join(" · ") : "siempre"
}

/** Niveles de prioridad, para no exponer un número desnudo. */
export const PRIORITY_LEVELS = [
  { value: 0, label: "Normal", hint: "Se aplica si no hay otra regla que compita." },
  { value: 10, label: "Alta", hint: "Gana sobre las reglas normales." },
  { value: 20, label: "Máxima", hint: "Gana sobre todas las demás." },
]

export function priorityLabel(value: number): string {
  return (
    PRIORITY_LEVELS.slice().reverse().find((l) => value >= l.value)?.label ??
    "Normal"
  )
}
