"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { formatCurrency, formatDay } from "@/lib/format"
import { DELETE_RESERVATION_FORBIDDEN_MESSAGE } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { deleteReservation } from "@/app/(panel)/reservas/actions"
import type { ReservationSummary } from "./reservation-types"

/**
 * Eliminar una reserva: se va de todo el sistema (calendario, web, pagos
 * pendientes, avisos) y queda un registro de quién la borró. Solo el dueño o un
 * administrador, y solo si no hubo plata de por medio; en ese caso el diálogo
 * explica por qué y manda a cancelar, que conserva el historial.
 */
export function DeleteReservationButton({
  reservation,
  canDelete,
  redirectTo,
  size = "sm",
  className,
}: {
  reservation: ReservationSummary
  canDelete: boolean
  /** Adónde ir después de borrar (la ficha de una reserva borrada ya no existe). */
  redirectTo?: string
  size?: React.ComponentProps<typeof Button>["size"]
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const { code, unitName, checkIn, checkOut, guestName, paid, currency, deleteBlocker, status } = reservation

  if (!canDelete) {
    return <p className="text-xs text-muted-foreground">{DELETE_RESERVATION_FORBIDDEN_MESSAGE}</p>
  }

  async function confirm() {
    setPending(true)
    const res = await deleteReservation(reservation.id)
    setPending(false)
    if (res.ok) {
      toast.success(`Reserva ${code} eliminada.`)
      setOpen(false)
      if (redirectTo) router.push(redirectTo)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo eliminar la reserva.")
    }
  }

  const stay = `${unitName} · ${formatDay(checkIn)} → ${formatDay(checkOut)} · ${guestName}`

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger
        className={cn(buttonVariants({ variant: "outline", size }), "border-destructive/40 text-destructive hover:bg-destructive/10", className)}
      >
        <Trash2 /> Eliminar reserva
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {deleteBlocker ? (
          <>
            <DialogHeader>
              <DialogTitle>Esta reserva no se puede eliminar</DialogTitle>
              <DialogDescription>
                {code} · {stay}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 text-sm">
              {deleteBlocker === "payments" ? (
                <p>
                  Tiene pagos registrados{paid > 0 ? ` (${formatCurrency(paid, currency)} cobrados)` : ""}. Una reserva
                  con plata de por medio no se borra, para que el historial contable quede completo.
                </p>
              ) : (
                <p>
                  Tiene un link de pago de Mercado Pago abierto. Si la eliminás y la persona paga igual, el cobro
                  entraría a tu cuenta sin una reserva que lo explique.
                </p>
              )}
              {status !== "cancelled" && status !== "expired" ? (
                <p>
                  Lo que sí podés hacer es <strong>cancelarla</strong>: se liberan las fechas y la reserva queda en
                  el historial.
                </p>
              ) : (
                <p>Ya está cancelada: sus fechas están libres y queda en el historial.</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Entendido
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>¿Eliminar la reserva {code}?</DialogTitle>
              <DialogDescription>{stay}</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-2 text-sm">
              <li>Se borra del sistema y se liberan sus fechas en el calendario y en la web.</li>
              <li>Se eliminan también sus pagos pendientes y los avisos que estuvieran por enviarse.</li>
              <li>
                <strong>No se puede deshacer.</strong> Queda anotado quién la eliminó.
              </li>
            </ul>
            <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              Si solo querés anularla, mejor cancelala: queda en el historial como Cancelada.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                Volver
              </Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
                {pending ? "Eliminando…" : "Sí, eliminar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
