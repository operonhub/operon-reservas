import type { DeleteBlocker, ReservationStatus } from "@/lib/reservation-rules"

/**
 * Lo que necesitan saber los diálogos de editar, cancelar, reabrir y eliminar
 * sobre una reserva. Lo arman la ficha y el tablero con los datos que ya
 * tienen; no incluye nada que no se pueda mostrar en pantalla.
 */
export type ReservationSummary = {
  id: string
  code: string
  status: ReservationStatus
  unitId: string
  unitName: string
  checkIn: string
  checkOut: string
  guests: number
  guestName: string
  guestEmail: string | null
  guestPhone: string | null
  notes: string | null
  currency: string
  total: number | null
  /** Lo realmente cobrado (pagos acreditados). */
  paid: number
  /** Por qué no se puede eliminar, si no se puede. */
  deleteBlocker: DeleteBlocker
}

export type UnitOption = {
  id: string
  name: string
  capacity: number
  /** false si la unidad está dada de baja (solo se ofrece si la reserva ya está en ella). */
  active?: boolean
}
