import { createHash, randomBytes } from "node:crypto"

/**
 * Links de invitación para dueños nuevos (migración 0026).
 *
 * El token viaja solo en el link; la base guarda su SHA-256. Así, quien lea
 * la tabla de invitaciones no puede usar ninguna. SOLO servidor.
 */

/** 32 bytes en base64url: 43 caracteres. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
