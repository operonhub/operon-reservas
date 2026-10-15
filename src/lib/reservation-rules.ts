import { RESERVATION_STATUS_LABELS } from "./constants"
import { formatCurrency, formatDay } from "./format"
import type { Enums } from "./supabase/types"

/**
 * Reglas de lo que se puede hacer con una reserva (editar, cancelar, reabrir,
 * eliminar) y cómo se cuenta en pantalla. Lógica pura, sin imports de servidor:
 * la usan componentes de cliente, las server actions y las pruebas. La base
 * impone las mismas reglas (migración 0046); esto es para no ofrecer lo que
 * después va a rechazar y para explicarlo en criollo.
 */

export type ReservationStatus = Enums<"reservation_status">

/** Cancelada y expirada son definitivas: no se editan ni se reabren. */
export function isEditableStatus(status: ReservationStatus): boolean {
  return status !== "cancelled" && status !== "expired"
}

/** Lo realmente cobrado (pagos acreditados). */
export function paidTotal(payments: { amount: number; status: string }[]): number {
  return payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + Number(p.amount), 0)
}

/**
 * Por qué una reserva no se puede eliminar, si no se puede.
 *  - "payments": hubo plata (acreditada o reintegrada): se cancela y queda el historial.
 *  - "checkout": hay un link de pago de Mercado Pago abierto: si la persona pagara
 *    después, el cobro entraría sin reserva que lo explique.
 */
export type DeleteBlocker = "payments" | "checkout" | null

export function deleteBlocker(payments: { status: string }[], hasOpenCheckout: boolean): DeleteBlocker {
  if (payments.some((p) => p.status === "paid" || p.status === "refunded")) return "payments"
  if (hasOpenCheckout) return "checkout"
  return null
}

/** Cómo se llama el botón que lleva de un estado a otro. */
export function transitionLabel(from: ReservationStatus, to: ReservationStatus): string {
  if (from === "completed" && to === "confirmed") return "Reabrir"
  if (to === "cancelled") return "Cancelar reserva"
  return RESERVATION_STATUS_LABELS[to]
}

/** Cancelar y reabrir piden confirmación: son los cambios que se lamentan. */
export function needsConfirmation(from: ReservationStatus, to: ReservationStatus): boolean {
  return to === "cancelled" || (from === "completed" && to === "confirmed")
}

/**
 * ¿Se le ofrece avisar al huésped por mail? Solo al cancelar, si tiene mail y
 * si la reserva no estaba "Completada" (sacarla de ahí es corregir un cierre,
 * no una novedad para el huésped: la base no avisa en ese caso).
 */
export function offersGuestEmail(from: ReservationStatus, to: ReservationStatus, guestEmail: string | null): boolean {
  return to === "cancelled" && from !== "completed" && Boolean(guestEmail?.trim())
}

/** Cómo queda la cuenta después de cambiar el total: saldo a cobrar, al día, o cobrado de más. */
export function balanceMessage(
  total: number | null,
  paid: number,
  currency: string
): { tone: "unknown" | "due" | "even" | "over"; text: string } {
  if (total == null) return { tone: "unknown", text: "Sin tarifa para esas noches: el total queda sin calcular." }
  const balance = total - paid
  if (balance > 0) return { tone: "due", text: `Saldo a cobrar: ${formatCurrency(balance, currency)}.` }
  if (balance === 0) return { tone: "even", text: "Queda totalmente abonada." }
  return {
    tone: "over",
    text: `Ya se cobraron ${formatCurrency(-balance, currency)} de más. Los pagos no se tocan: el reintegro lo gestionás vos.`,
  }
}

// ---------------------------------------------------------------------------
// Historial de cambios (migración 0046)
// ---------------------------------------------------------------------------

export type AuditEntry = {
  at: string
  action: "updated" | "cancelled" | "reopened" | "deleted"
  reservation_id: string
  reservation_code: string
  actor_name: string
  detail: Record<string, unknown>
}

type Change = { from: unknown; to: unknown }
const isChange = (value: unknown): value is Change =>
  typeof value === "object" && value !== null && "from" in value && "to" in value
const text = (value: unknown) => (value == null || value === "" ? "—" : String(value))
const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDay(value) : text(value))
const money = (value: unknown) => (value == null ? "sin total" : formatCurrency(Number(value)))
const statusName = (value: unknown) => RESERVATION_STATUS_LABELS[value as ReservationStatus] ?? text(value)

/** Una línea en criollo de lo que pasó, para el historial. */
export function describeAudit(entry: AuditEntry): string {
  const d = entry.detail ?? {}
  switch (entry.action) {
    case "updated": {
      const parts: string[] = []
      if (isChange(d.unit)) parts.push(`cabaña ${text(d.unit.from)} → ${text(d.unit.to)}`)
      if (isChange(d.check_in)) parts.push(`ingreso ${day(d.check_in.from)} → ${day(d.check_in.to)}`)
      if (isChange(d.check_out)) parts.push(`salida ${day(d.check_out.from)} → ${day(d.check_out.to)}`)
      if (isChange(d.guests)) parts.push(`huéspedes ${text(d.guests.from)} → ${text(d.guests.to)}`)
      if (isChange(d.total)) parts.push(`total ${money(d.total.from)} → ${money(d.total.to)}`)
      if (isChange(d.guest)) parts.push(`huésped ${text(d.guest.from)} → ${text(d.guest.to)}`)
      if (d.notes) parts.push("observaciones")
      return parts.length ? `Editó la reserva: ${parts.join(", ")}.` : "Editó la reserva."
    }
    case "cancelled": {
      const paid = Number(d.paid_amount ?? 0)
      const cobrado = paid > 0 ? ` Tenía ${formatCurrency(paid)} cobrados.` : ""
      const aviso = d.guest_notified ? " Se avisó al huésped." : " No se avisó al huésped."
      return `Canceló la reserva (estaba ${statusName(d.from)}).${cobrado}${aviso}`
    }
    case "reopened":
      return `Reabrió la reserva: de ${statusName(d.from)} volvió a ${statusName(d.to)}.`
    case "deleted": {
      const who = d.guest ? ` de ${text(d.guest)}` : ""
      const where = d.unit ? ` · ${text(d.unit)}` : ""
      const when = d.check_in && d.check_out ? ` · ${day(d.check_in)} → ${day(d.check_out)}` : ""
      return `Eliminó la reserva${who}${where}${when} (estaba ${statusName(d.status)}).`
    }
  }
}

/** Las filas que devuelve reservation_audit_log, ya con la forma que usa la pantalla. */
export function toAuditEntries(
  rows:
    | { at: string; action: string; reservation_id: string; reservation_code: string; actor_name: string; detail: unknown }[]
    | null
    | undefined
): AuditEntry[] {
  return (rows ?? []).map((row) => ({
    at: row.at,
    action: row.action as AuditEntry["action"],
    reservation_id: row.reservation_id,
    reservation_code: row.reservation_code,
    actor_name: row.actor_name,
    detail: (row.detail && typeof row.detail === "object" ? row.detail : {}) as Record<string, unknown>,
  }))
}
