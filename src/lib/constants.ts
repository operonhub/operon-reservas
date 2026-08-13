import type { Enums } from "./supabase/types"

// ---------- Estados de reserva ----------
export const RESERVATION_STATUS_LABELS: Record<Enums<"reservation_status">, string> = {
  inquiry: "Consulta",
  pending: "Pendiente",
  pending_payment: "Esperando seña",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
}

// Transiciones permitidas — ESPEJO de _can_transition() en la base (0003).
// Fuente única de verdad de estados también en el cliente.
export const RESERVATION_TRANSITIONS: Record<
  Enums<"reservation_status">,
  Enums<"reservation_status">[]
> = {
  inquiry: ["pending", "pending_payment", "cancelled"],
  pending: ["pending_payment", "confirmed", "cancelled"],
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

/** Estados que retienen inventario (ocupan la unidad). Espejo de holds_inventory(). */
export const HOLDING_STATUSES: Enums<"reservation_status">[] = [
  "pending",
  "pending_payment",
  "confirmed",
  "completed",
]

// ---------- Origen de la reserva ----------
export const RESERVATION_SOURCE_LABELS: Record<Enums<"reservation_source">, string> = {
  direct: "Web propia",
  manual: "Carga manual",
  booking: "Booking",
  airbnb: "Airbnb",
  whatsapp: "WhatsApp",
  other: "Otro",
}

// ---------- Tarifas ----------
export const RATE_KIND_LABELS: Record<Enums<"rate_kind">, string> = {
  base: "Base",
  seasonal: "Temporada",
  special: "Fecha especial",
}

// ---------- Ocupación (para el calendario) ----------
export type CellState = "available" | "reserved" | "blocked"

export const OCCUPANCY_LEGEND: { state: CellState; label: string; swatch: string }[] = [
  { state: "available", label: "Disponible", swatch: "bg-muted" },
  { state: "reserved", label: "Reservado", swatch: "bg-primary/70" },
  { state: "blocked", label: "Bloqueado", swatch: "bg-amber-500/70" },
]
