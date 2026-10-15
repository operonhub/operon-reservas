"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RESERVATION_TRANSITIONS, RESERVATION_STATUS_LABELS } from "@/lib/constants"
import { needsConfirmation, transitionLabel } from "@/lib/reservation-rules"
import { transitionReservation } from "@/app/(panel)/reservas/actions"
import type { Enums } from "@/lib/supabase/types"
import { StatusChangeDialog, type StatusChangeKind } from "./status-change-dialog"
import type { ReservationSummary } from "./reservation-types"

/**
 * Acciones de transición de estado: solo muestra las permitidas (máquina de
 * estados única, lib/constants). Cancelar y reabrir piden confirmación antes
 * de hacerse.
 */
export function StatusControl({ reservation }: { reservation: ReservationSummary }) {
  const router = useRouter()
  const [pending, setPending] = React.useState<Enums<"reservation_status"> | null>(null)
  const [dialog, setDialog] = React.useState<StatusChangeKind | null>(null)
  const { id, status } = reservation
  const next = RESERVATION_TRANSITIONS[status]

  if (next.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {status === "cancelled"
          ? "Cancelada: ya no se puede volver a abrir. Si fue un error, cargala de nuevo."
          : "Expirada: ya no se puede volver a abrir. Si el huésped paga, el sistema la recupera sola."}
      </p>
    )
  }

  async function go(to: Enums<"reservation_status">, options?: { notifyGuest: boolean }) {
    setPending(to)
    const res = await transitionReservation(id, to, options)
    setPending(null)
    if (res.ok) {
      setDialog(null)
      toast.success(
        status === "completed" && to === "confirmed"
          ? "Reserva reabierta: vuelve a estar Confirmada."
          : to === "cancelled"
            ? "Reserva cancelada."
            : `Reserva → ${RESERVATION_STATUS_LABELS[to]}`
      )
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo cambiar el estado.")
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {next.map((to) => (
          <Button
            key={to}
            size="sm"
            variant={to === "cancelled" ? "destructive" : "outline"}
            disabled={pending !== null}
            onClick={() =>
              needsConfirmation(status, to) ? setDialog(to === "cancelled" ? "cancelled" : "reopen") : go(to)
            }
          >
            {pending === to && dialog === null ? "…" : transitionLabel(status, to)}
          </Button>
        ))}
      </div>
      {status === "completed" && (
        <p className="mt-2 text-xs text-muted-foreground">
          ¿La marcaste como completada por error? Reabrila y vuelve a Confirmada.
        </p>
      )}

      <StatusChangeDialog
        reservation={reservation}
        kind={dialog}
        pending={pending !== null}
        onClose={() => setDialog(null)}
        onConfirm={(options) => go(dialog === "cancelled" ? "cancelled" : "confirmed", options)}
      />
    </>
  )
}
