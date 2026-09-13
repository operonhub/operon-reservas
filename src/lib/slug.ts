/**
 * Link público del complejo: /reservar/[slug].
 *
 * La regla tiene que coincidir con `app_private.slug_is_valid` (migración
 * 0026): acá sirve para avisar mientras se escribe, la base es la que decide.
 * Sin imports de servidor: lo usa también el asistente en el navegador.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "admin", "api", "app", "ayuda", "bienvenida", "demo", "ical", "invitacion",
  "login", "operon", "pago", "panel", "reservar", "sin-acceso", "soporte", "www",
]

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/

/** "Cabañas del Ñandú" -> "cabanas-del-nandu". */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "")
}

/**
 * Mientras se escribe el link a mano: lo mismo que `slugify`, pero sin
 * recortar el guion final, para poder seguir con la palabra siguiente.
 * Antes el campo borraba lo que no fuera [a-z0-9-] y "cabañas anashe"
 * quedaba "cabaasanashe".
 */
export function toSlugInput(typed: string): string {
  return typed
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !slug.includes("--") && !RESERVED_SLUGS.includes(slug)
}
