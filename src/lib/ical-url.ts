/**
 * Qué links de calendario se aceptan para importar (auditoría B-03).
 *
 * El worker de sincronización descarga cada hora lo que el propietario pegó.
 * Sin validar, un link a una dirección interna (la metadata de la nube,
 * localhost, la red privada) lo convertía en una puerta a esa red. Se acepta
 * cualquier https público —Airbnb, Booking, Google Calendar, VRBO— y
 * `webcal://`, que es como lo copian muchos, se convierte a `https://`.
 *
 * Esta es la fuente única: la Edge Function la importa por ruta relativa
 * (no puede importar desde `src/`), y por eso el archivo no usa nada de Node
 * ni de Next.
 *
 * Límite conocido: un dominio público que resuelve a una IP interna pasa
 * esta validación; frenarlo exige resolver el DNS al momento de la descarga.
 * El worker nunca devuelve lo que descarga, solo lo interpreta como iCal.
 */

export type IcalUrlError =
  | "INVALID"
  | "NOT_HTTPS"
  | "CREDENTIALS"
  | "PORT"
  | "IP_ADDRESS"
  | "PRIVATE_HOST"

export type IcalUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: IcalUrlError }

const MAX_LENGTH = 2048

// Nombres que solo existen dentro de una red: nunca son un calendario público.
const PRIVATE_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "home.arpa",
  "corp",
  "private",
]

function isIpLiteral(hostname: string): boolean {
  // El parser de URL ya normaliza 2130706433, 0x7f.1 y similares a
  // 127.0.0.1, y las IPv6 llegan entre corchetes.
  return hostname.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}

function isPrivateHostname(hostname: string): boolean {
  // Sin punto ("localhost", "metadata", "db") es un nombre de red interna.
  if (!hostname.includes(".")) return true
  return PRIVATE_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`))
}

/** Valida un link de calendario y lo devuelve normalizado. */
export function normalizeIcalUrl(raw: string): IcalUrlResult {
  const value = raw.trim().replace(/^webcal:\/\//i, "https://")
  if (!value || value.length > MAX_LENGTH) return { ok: false, reason: "INVALID" }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, reason: "INVALID" }
  }

  if (url.protocol !== "https:") return { ok: false, reason: "NOT_HTTPS" }
  if (url.username || url.password) return { ok: false, reason: "CREDENTIALS" }
  if (url.port) return { ok: false, reason: "PORT" }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  if (isIpLiteral(hostname)) return { ok: false, reason: "IP_ADDRESS" }
  if (isPrivateHostname(hostname)) return { ok: false, reason: "PRIVATE_HOST" }

  return { ok: true, url: url.toString() }
}

const PUBLIC_ADDRESS =
  "tiene que ser la dirección pública que te da la plataforma al exportar el calendario."

export const ICAL_URL_ERROR_MESSAGES: Record<IcalUrlError, string> = {
  INVALID: "no parece un link. Copialo entero desde la plataforma.",
  NOT_HTTPS: "tiene que empezar con https:// (o webcal://).",
  CREDENTIALS: "no puede llevar usuario ni contraseña.",
  PORT: PUBLIC_ADDRESS,
  IP_ADDRESS: PUBLIC_ADDRESS,
  PRIVATE_HOST: PUBLIC_ADDRESS,
}
