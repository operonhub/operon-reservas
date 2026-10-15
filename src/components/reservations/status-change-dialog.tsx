"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatDay } from "@/lib/format"
import { offersGuestEmail } from "@/lib/reservation-rules"
import { RESERVATION_STATUS_LABELS } from "@/lib/constants"
import type { ReservationSummary } from "./reservation-types"

export type StatusChangeKind = "cancelled" | "reopen"

/**
 * Confirmación de cancelar o reabrir. Son los dos cambios que se lamentan:
 * cancelar es definitivo y libera las fechas; reabrir devuelve una
 * "Completada" a "Confirmada". Cuenta qué pasa, y pide una confirmación extra
 * cuando hay plata cobrada (cancelar no la devuelve) o un mail de por medio.
 */
export function StatusChangeDialog({
  reservation,
  kind,
  pending,
  onClose,
  onConfirm,
}: {
  reservation: ReservationSummary
  kind: StatusChangeKind | null
  pending: boolean
  onClose: () => void
  onConfirm: (options: { notifyGuest: boolean }) => void
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        {kind && (
          <Body
            // Se vuelve a armar cada vez que se abre: las casillas arrancan en su valor por defecto.
            key={kind}
            reservation={reservation}
            kind={kind}
            pending={pending}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Body({
  reservation,
  kind,
  pending,
  onClose,
  onConfirm,
}: {
  reservation: ReservationSummary
  kind: StatusChangeKind
  pending: boolean
  onClose: () => void
  onConfirm: (options: { notifyGuest: boolean }) => void
}) {
  const { code, status, unitName, checkIn, checkOut, guestName, guestEmail, paid, currency } = reservation
  const [notify, setNotify] = React.useState(true)
  const [understood, setUnderstood] = React.useState(false)
  const canNotify = offersGuestEmail(status, "cancelled", guestEmail)
  const needsAck = kind === "cancelled" && paid > 0
  const ready = !needsAck || understood

  const stay = `${unitName} · ${formatDay(checkIn)} → ${formatDay(checkOut)} · ${guestName}`

  if (kind === "reopen") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Reabrir la reserva {code}</DialogTitle>
          <DialogDescription>{stay}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          <li>Vuelve a estar <strong>{RESERVATION_STATUS_LABELS.confirmed}</strong>, como antes de marcarla completada.</li>
          <li>Sigue ocupando las mismas fechas en el calendario y en la web.</li>
          <li>No se le avisa al huésped: es una corrección interna.</li>
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Volver
          </Button>
          <Button type="button" disabled={pending} onClick={() => onConfirm({ notifyGuest: false })}>
            {pending ? "Reabriendo…" : "Reabrir reserva"}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>¿Cancelar la reserva {code}?</DialogTitle>
        <DialogDescription>{stay}</DialogDescription>
      </DialogHeader>

      <ul className="grid gap-2 text-sm">
        <li>Se liberan las fechas en el calendario y en la web.</li>
        <li>
          Queda en el historial como <strong>Cancelada</strong> y no se puede volver a abrir. Si fue un error,
          hay que cargarla de nuevo.
        </li>
        {status === "completed" && <li>Estaba marcada como completada: no se le avisa al huésped.</li>}
      </ul>

      {needsAck && (
        <div className="grid gap-2 rounded-lg border border-warning/50 bg-warning/20 p-3 text-sm">
          <p>
            <strong>Tiene {formatCurrency(paid, currency)} cobrados.</strong> Cancelar no devuelve el dinero: los
            pagos quedan registrados y el reintegro lo gestionás vos por fuera.
          </p>
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox checked={understood} onCheckedChange={(value) => setUnderstood(value === true)} className="mt-0.5" />
            <span>Entiendo que el dinero cobrado no se devuelve solo.</span>
          </label>
        </div>
      )}

      {canNotify && (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={notify} onCheckedChange={(value) => setNotify(value === true)} className="mt-0.5" />
          <span>
            Avisar al huésped por email
            <span className="block text-xs text-muted-foreground">Le llega la cancelación a {guestEmail}.</span>
          </span>
        </label>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Volver
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending || !ready}
          onClick={() => onConfirm({ notifyGuest: canNotify && notify })}
        >
          {pending ? "Cancelando…" : "Cancelar reserva"}
        </Button>
      </DialogFooter>
    </>
  )
}
