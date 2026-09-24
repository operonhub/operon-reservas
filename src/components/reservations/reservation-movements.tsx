"use client"

import * as React from "react"
import { toast } from "sonner"
import { CheckCircle2, LogIn, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  recordReservationMovement,
  type ReservationMovement,
} from "@/app/(panel)/reservas/actions"
import { DEFAULT_TIMEZONE } from "@/lib/format"

function formatMovementAt(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: DEFAULT_TIMEZONE,
  }).format(new Date(value))
}

export function ReservationMovements({
  reservationId,
  checkInAt,
  checkOutAt,
  checkInTime,
  checkOutTime,
}: {
  reservationId: string
  checkInAt: string | null
  checkOutAt: string | null
  checkInTime?: string | null
  checkOutTime?: string | null
}) {
  const [pending, setPending] = React.useState<ReservationMovement | null>(null)

  async function record(movement: ReservationMovement) {
    setPending(movement)
    const result = await recordReservationMovement(reservationId, movement)
    setPending(null)
    if (result.ok) {
      toast.success(movement === "checkin" ? "Ingreso registrado." : "Salida registrada.")
    } else {
      toast.error(result.error ?? "No se pudo registrar el movimiento.")
    }
  }

  return (
    <section className="mx-auto mt-5 max-w-3xl rounded-2xl border bg-card p-5 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="label-mono text-muted-foreground">Operación</h2>
          <p className="mt-1 text-sm font-medium">Seguimiento de ingreso y salida</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ventana configurada: ingreso desde {checkInTime?.slice(0, 5) ?? "—"} · salida hasta {checkOutTime?.slice(0, 5) ?? "—"}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">Los horarios reales quedan guardados en la reserva.</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MovementButton
          kind="checkin"
          value={checkInAt}
          pending={pending === "checkin"}
          onClick={() => void record("checkin")}
        />
        <MovementButton
          kind="checkout"
          value={checkOutAt}
          pending={pending === "checkout"}
          onClick={() => void record("checkout")}
        />
      </div>
    </section>
  )
}

function MovementButton({
  kind,
  value,
  pending,
  onClick,
}: {
  kind: ReservationMovement
  value: string | null
  pending: boolean
  onClick: () => void
}) {
  const isCheckIn = kind === "checkin"
  return (
    <Button
      type="button"
      variant={value ? "secondary" : "outline"}
      className="h-auto min-h-14 justify-start whitespace-normal text-left"
      disabled={pending || Boolean(value)}
      onClick={onClick}
    >
      {value ? <CheckCircle2 className="text-success" /> : isCheckIn ? <LogIn /> : <LogOut />}
      <span>
        <span className="block">{pending ? "Guardando…" : value ? (isCheckIn ? "Ingreso registrado" : "Salida registrada") : isCheckIn ? "Registrar ingreso" : "Registrar salida"}</span>
        {value && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{formatMovementAt(value)}</span>}
      </span>
    </Button>
  )
}
