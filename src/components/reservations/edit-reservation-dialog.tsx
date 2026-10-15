"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pencil } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { DateField } from "@/components/ui/date-field"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { addDays, checkOutFor, formatCurrency, formatDay, whatsappHref } from "@/lib/format"
import { balanceMessage } from "@/lib/reservation-rules"
import { cn } from "@/lib/utils"
import { previewReservationPrice, updateReservation, type PricePreview } from "@/app/(panel)/reservas/actions"
import type { ReservationSummary, UnitOption } from "./reservation-types"

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * Editar una reserva: cabaña, fechas, huéspedes, datos del huésped y notas.
 * Antes de guardar muestra el total nuevo y cómo queda el saldo (los pagos ya
 * registrados no se tocan). La base valida todo de nuevo al guardar: fechas
 * libres, capacidad y estadía mínima.
 */
export function EditReservationDialog({
  reservation,
  units,
  variant = "outline",
  size = "sm",
  label = "Editar reserva",
  className,
}: {
  reservation: ReservationSummary
  units: UnitOption[]
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  label?: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [session, setSession] = React.useState(0)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Cada vez que se abre parte de lo guardado: un cambio descartado no queda a medias.
        if (next) setSession((n) => n + 1)
        setOpen(next)
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant, size }), className)}>
        <Pencil /> {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <EditForm key={session} reservation={reservation} units={units} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  reservation,
  units,
  onDone,
}: {
  reservation: ReservationSummary
  units: UnitOption[]
  onDone: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [unitId, setUnitId] = React.useState(reservation.unitId)
  const [checkIn, setCheckIn] = React.useState(reservation.checkIn)
  const [checkOut, setCheckOut] = React.useState(reservation.checkOut)
  const [guests, setGuests] = React.useState(String(reservation.guests))
  const [preview, setPreview] = React.useState<PricePreview | "loading" | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const ticket = React.useRef(0)
  const { currency, total, paid } = reservation

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const unit = units.find((u) => u.id === unitId)
  const guestsNumber = Number(guests)
  const stayChanged =
    unitId !== reservation.unitId ||
    checkIn !== reservation.checkIn ||
    checkOut !== reservation.checkOut ||
    guestsNumber !== reservation.guests
  const overCapacity = Boolean(unit && guestsNumber > unit.capacity)
  const tooShort =
    preview !== null && preview !== "loading" && preview.ok && preview.minNights != null && preview.nights < preview.minNights

  // El precio se pregunta a la base cuando termina de cambiar algo que lo afecta.
  function schedulePreview(next: { unitId: string; checkIn: string; checkOut: string; guests: string }) {
    if (timer.current) clearTimeout(timer.current)
    const changed =
      next.unitId !== reservation.unitId ||
      next.checkIn !== reservation.checkIn ||
      next.checkOut !== reservation.checkOut ||
      Number(next.guests) !== reservation.guests
    const valid = next.unitId && next.checkIn && next.checkOut && next.checkOut > next.checkIn && Number(next.guests) >= 1
    ticket.current += 1
    if (!changed || !valid) {
      setPreview(null)
      return
    }
    setPreview("loading")
    const mine = ticket.current
    timer.current = setTimeout(async () => {
      const result = await previewReservationPrice({
        unitId: next.unitId,
        checkIn: next.checkIn,
        checkOut: next.checkOut,
        guests: Number(next.guests),
      })
      if (mine === ticket.current) setPreview(result)
    }, 350)
  }

  function changeUnit(value: string) {
    setUnitId(value)
    schedulePreview({ unitId: value, checkIn, checkOut, guests })
  }
  // Al mover el ingreso, la salida se corre sola si quedó antes (conserva las noches).
  function changeCheckIn(value: string) {
    const out = checkOutFor(value, checkOut, checkIn)
    setCheckIn(value)
    setCheckOut(out)
    schedulePreview({ unitId, checkIn: value, checkOut: out, guests })
  }
  function changeCheckOut(value: string) {
    setCheckOut(value)
    schedulePreview({ unitId, checkIn, checkOut: value, guests })
  }
  function changeGuests(value: string) {
    setGuests(value)
    schedulePreview({ unitId, checkIn, checkOut, guests: value })
  }

  async function handle(formData: FormData) {
    setPending(true)
    const res = await updateReservation(formData)
    setPending(false)
    if (!res.ok) {
      toast.error(res.error ?? "No se pudieron guardar los cambios.")
      return
    }
    const summary = res.summary
    if (!summary?.changed) {
      toast("No había nada para cambiar.")
      onDone()
      return
    }

    const lines: string[] = []
    if (stayChanged) {
      lines.push(`Total: ${formatCurrency(summary.total, summary.currency)}.`)
      lines.push(balanceMessage(summary.total, summary.paid, summary.currency).text)
    }
    // Editar no manda ningún mail: si cambió algo que el huésped tiene que saber, se lo avisa la persona.
    const phone = String(formData.get("phone") ?? "").trim()
    const firstName = String(formData.get("full_name") ?? "").trim().split(/\s+/)[0] ?? ""
    const where = units.find((u) => u.id === unitId)?.name ?? reservation.unitName
    toast.success("Cambios guardados.", {
      description: lines.join(" ") || undefined,
      duration: stayChanged ? 12000 : 4000,
      action:
        stayChanged && phone
          ? {
              label: "Avisar por WhatsApp",
              onClick: () => {
                const text = `Hola ${firstName}! Te escribo por tu reserva ${summary.code}: hubo un cambio. Ahora es en ${where}, del ${formatDay(checkIn)} al ${formatDay(checkOut)}.`
                window.open(`${whatsappHref(phone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")
              },
            }
          : undefined,
    })
    router.refresh()
    onDone()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar la reserva {reservation.code}</DialogTitle>
        <DialogDescription>
          Podés cambiar la cabaña, las fechas, los huéspedes y los datos de contacto. Se revisa que las fechas
          estén libres.
        </DialogDescription>
      </DialogHeader>

      <form action={handle} className="grid gap-4">
        <input type="hidden" name="id" value={reservation.id} />

        <div className="grid gap-1.5">
          <Label htmlFor="edit_unit_id">Unidad</Label>
          <select
            id="edit_unit_id"
            name="unit_id"
            required
            className={selectCls}
            value={unitId}
            onChange={(event) => changeUnit(event.target.value)}
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} (hasta {u.capacity}p){u.active === false ? " · dada de baja" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="edit_check_in">Ingreso</Label>
            <DateField id="edit_check_in" name="check_in" value={checkIn} onValueChange={changeCheckIn} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit_check_out">Salida</Label>
            <DateField
              id="edit_check_out"
              name="check_out"
              orderNotice={false}
              min={checkIn ? addDays(checkIn, 1) : undefined}
              value={checkOut}
              onValueChange={changeCheckOut}
              required
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit_guests">Huéspedes</Label>
          <Input
            id="edit_guests"
            name="guests"
            type="number"
            min={1}
            max={unit?.capacity}
            value={guests}
            onChange={(event) => changeGuests(event.target.value)}
            required
            aria-invalid={overCapacity || undefined}
          />
          {overCapacity && unit && (
            <p className="text-xs font-medium text-destructive">
              {unit.name} es para hasta {unit.capacity} {unit.capacity === 1 ? "persona" : "personas"}.
            </p>
          )}
        </div>

        <PriceBox preview={preview} stayChanged={stayChanged} total={total} paid={paid} currency={currency} />

        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Huésped</p>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit_full_name">Nombre y apellido</Label>
              <Input id="edit_full_name" name="full_name" required defaultValue={reservation.guestName} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="edit_email">Email</Label>
                <Input id="edit_email" name="email" type="email" defaultValue={reservation.guestEmail ?? ""} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="edit_phone">Teléfono</Label>
                <Input id="edit_phone" name="phone" defaultValue={reservation.guestPhone ?? ""} />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="edit_notes">Observaciones</Label>
          <Textarea id="edit_notes" name="notes" rows={2} defaultValue={reservation.notes ?? ""} />
        </div>

        <p className="text-xs text-muted-foreground">
          {paid > 0 && <>Los {formatCurrency(paid, currency)} ya cobrados no se tocan. </>}
          Editar no le manda ningún mail al huésped: si cambió algo que tiene que saber, avisale vos.
        </p>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={pending || overCapacity || tooShort}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

/** El total nuevo y cómo queda el saldo, mientras se edita. */
function PriceBox({
  preview,
  stayChanged,
  total,
  paid,
  currency,
}: {
  preview: PricePreview | "loading" | null
  stayChanged: boolean
  total: number | null
  paid: number
  currency: string
}) {
  if (!stayChanged || preview === null) return null
  const box = "rounded-lg border bg-muted/40 p-3 text-sm"
  if (preview === "loading") return <p className={cn(box, "text-muted-foreground")}>Calculando el precio…</p>
  if (!preview.ok) return <p className={cn(box, "text-destructive")}>{preview.error}</p>

  const balance = balanceMessage(preview.total, paid, currency)
  return (
    <div className={cn(box, "grid gap-1")} aria-live="polite">
      {preview.minNights != null && preview.nights < preview.minNights && (
        <p className="font-medium text-destructive">
          Para esas fechas la estadía mínima es de {preview.minNights} noches.
        </p>
      )}
      <p>
        <span className="text-muted-foreground">Total nuevo: </span>
        <strong className="font-mono tabular-nums">{formatCurrency(preview.total, currency)}</strong>
        {total != null && preview.total !== total && (
          <span className="text-muted-foreground"> (antes {formatCurrency(total, currency)})</span>
        )}
      </p>
      <p className={cn(balance.tone === "over" && "font-medium text-destructive")}>{balance.text}</p>
    </div>
  )
}
