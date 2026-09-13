import { CURRENCY_CODES } from "@/lib/currencies"
import { isValidSlug } from "@/lib/slug"

/**
 * Borrador del asistente de configuración. Lo usan el navegador (para avisar
 * mientras se completa) y el servidor (para no confiar en el navegador); la
 * palabra final la tiene `complete_setup` en la base (migración 0026).
 */

export const MAX_UNITS = 30

/** Los números van como texto mientras se escriben: "85000," no es un error todavía. */
export type SetupUnit = { name: string; capacity: string; price: string }

export type SetupDraft = {
  name: string
  slug: string
  /** Si el dueño tocó el link a mano, cambiar el nombre ya no lo pisa. */
  slugEdited: boolean
  city: string
  currency: string
  checkinTime: string
  checkoutTime: string
  units: SetupUnit[]
}

export const SETUP_STEPS = [
  { key: "nombre", label: "Tu complejo" },
  { key: "link", label: "Tu link" },
  { key: "detalles", label: "Detalles" },
  { key: "unidades", label: "Unidades" },
  { key: "precios", label: "Precios" },
  { key: "resumen", label: "Resumen" },
] as const

export const LAST_STEP = SETUP_STEPS.length - 1

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const PRICE_RE = /^\d{1,10}([.,]\d{1,2})?$/
const CAPACITY_RE = /^\d{1,2}$/

export function emptyUnit(): SetupUnit {
  return { name: "", capacity: "2", price: "" }
}

export function emptyDraft(): SetupDraft {
  return {
    name: "",
    slug: "",
    slugEdited: false,
    city: "",
    currency: "ARS",
    checkinTime: "14:00",
    checkoutTime: "10:00",
    units: [emptyUnit()],
  }
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "")

/** Lo que llega de la base (o del navegador) se trata como no confiable. */
export function normalizeDraft(raw: unknown): SetupDraft {
  const base = emptyDraft()
  if (!raw || typeof raw !== "object") return base
  const r = raw as Record<string, unknown>

  const units = Array.isArray(r.units)
    ? r.units.slice(0, MAX_UNITS).map((u): SetupUnit => {
        const x = (u && typeof u === "object" ? u : {}) as Record<string, unknown>
        return { name: text(x.name, 60), capacity: text(x.capacity, 3) || "2", price: text(x.price, 14) }
      })
    : []
  const checkin = text(r.checkinTime, 5)
  const checkout = text(r.checkoutTime, 5)

  return {
    name: text(r.name, 80),
    slug: text(r.slug, 48),
    slugEdited: r.slugEdited === true,
    city: text(r.city, 80),
    currency: (CURRENCY_CODES as readonly string[]).includes(text(r.currency, 3)) ? text(r.currency, 3) : base.currency,
    checkinTime: TIME_RE.test(checkin) ? checkin : base.checkinTime,
    checkoutTime: TIME_RE.test(checkout) ? checkout : base.checkoutTime,
    units: units.length > 0 ? units : base.units,
  }
}

/**
 * Lo que se tipea en el precio, tal como lo muestra el campo ("150.000,5"),
 * a lo que se guarda en el borrador ("150000,5"). Los puntos son solo de
 * formato y se descartan; la coma es el decimal, con dos dígitos como máximo.
 */
export function cleanPriceInput(typed: string): string {
  const [integer = "", ...decimals] = typed.replace(/[^\d,]/g, "").split(",")
  const whole = integer.replace(/^0+(?=\d)/, "").slice(0, 10)
  return decimals.length > 0 ? `${whole},${decimals.join("").slice(0, 2)}` : whole
}

/** "150000,5" -> "150.000,5": lo que se ve en el campo mientras se escribe. */
export function formatPriceInput(raw: string): string {
  const [integer, decimals] = raw.split(",")
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return decimals === undefined ? grouped : `${grouped},${decimals}`
}

/** "85000" o "85000,50". Con puntos de miles ("85.000") es ambiguo: se rechaza. */
export function parsePrice(raw: string): number | null {
  const value = raw.trim()
  if (!PRICE_RE.test(value)) return null
  const number = Number(value.replace(",", "."))
  return number > 0 ? number : null
}

export function parseCapacity(raw: string): number | null {
  const value = raw.trim()
  if (!CAPACITY_RE.test(value)) return null
  const number = Number(value)
  return number >= 1 && number <= 50 ? number : null
}

/** Mensaje del primer problema del paso, o null si se puede seguir. */
export function stepError(step: number, draft: SetupDraft): string | null {
  switch (step) {
    case 0: {
      const length = draft.name.trim().length
      if (length < 2) return "Escribí el nombre de tu complejo."
      if (length > 80) return "El nombre puede tener hasta 80 caracteres."
      return null
    }
    case 1:
      return isValidSlug(draft.slug)
        ? null
        : "El link tiene que tener entre 3 y 48 letras minúsculas, números o guiones."
    case 2:
      if (!(CURRENCY_CODES as readonly string[]).includes(draft.currency)) return "Elegí una moneda."
      if (!TIME_RE.test(draft.checkinTime) || !TIME_RE.test(draft.checkoutTime)) return "Revisá los horarios."
      if (draft.city.trim().length > 80) return "La ciudad puede tener hasta 80 caracteres."
      return null
    case 3: {
      if (draft.units.length === 0) return "Agregá al menos una unidad."
      if (draft.units.length > MAX_UNITS) return `Podés cargar hasta ${MAX_UNITS} unidades por ahora.`
      const seen = new Set<string>()
      for (const [index, unit] of draft.units.entries()) {
        const name = unit.name.trim()
        if (!name) return `Poné un nombre a la unidad ${index + 1}.`
        if (seen.has(name.toLowerCase())) return `Hay dos unidades que se llaman "${name}".`
        seen.add(name.toLowerCase())
        if (parseCapacity(unit.capacity) === null) {
          return `La capacidad de "${name}" tiene que ser entre 1 y 50 personas.`
        }
      }
      return null
    }
    case 4:
      for (const unit of draft.units) {
        if (parsePrice(unit.price) === null) {
          return `Poné el precio por noche de "${unit.name.trim()}".`
        }
      }
      return null
    default:
      return null
  }
}

/** Primer paso con algo pendiente; si está todo, el resumen. */
export function firstIncompleteStep(draft: SetupDraft): number {
  for (let step = 0; step < LAST_STEP; step++) {
    if (stepError(step, draft)) return step
  }
  return LAST_STEP
}

export function toSetupPayload(draft: SetupDraft) {
  return {
    name: draft.name.trim(),
    slug: draft.slug,
    city: draft.city.trim() || null,
    currency: draft.currency,
    timezone: "America/Argentina/Cordoba",
    checkin_time: draft.checkinTime,
    checkout_time: draft.checkoutTime,
    units: draft.units.map((unit) => ({
      name: unit.name.trim(),
      capacity: parseCapacity(unit.capacity),
      price: parsePrice(unit.price),
    })),
  }
}
