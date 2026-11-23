"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DateField } from "@/components/ui/date-field"
import { addDays, checkOutFor } from "@/lib/format"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SpecialPriceFields } from "@/components/reservations/special-price-fields"
import { createManualReservation, previewReservationPrice, type PricePreview } from "@/app/(panel)/reservas/actions"
import { Plus } from "lucide-react"

type Unit = { id: string; name: string; capacity: number }

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function NewReservationDialog({
  units,
  canSetPrice = false,
}: {
  units: Unit[]
  /** Solo dueño/administrador puede fijar un precio especial (0047). */
  canSetPrice?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [unitId, setUnitId] = React.useState(units[0]?.id ?? "")
  const [guests, setGuests] = React.useState("2")
  const [checkIn, setCheckIn] = React.useState("")
  const [checkOut, setCheckOut] = React.useState("")
  const [preview, setPreview] = React.useState<PricePreview | "loading" | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const ticket = React.useRef(0)

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function reset() {
    setUnitId(units[0]?.id ?? "")
    setGuests("2")
    setCheckIn("")
    setCheckOut("")
    setPreview(null)
  }

  // El precio del sistema se pregunta a la base cuando la estadía es válida.
  function schedulePreview(next: { unitId: string; checkIn: string; checkOut: string; guests: string }) {
    if (timer.current) clearTimeout(timer.current)
    const valid =
      next.unitId && next.checkIn && next.checkOut && next.checkOut > next.checkIn && Number(next.guests) >= 1
    ticket.current += 1
    if (!valid) {
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

  // Al elegir el ingreso, la salida se propone sola (y se corre si quedó antes).
  function changeCheckIn(next: string) {
    const out = checkOutFor(next, checkOut, checkIn)
    setCheckOut(out)
    setCheckIn(next)
    schedulePreview({ unitId, checkIn: next, checkOut: out, guests })
  }

  function changeCheckOut(next: string) {
    setCheckOut(next)
    schedulePreview({ unitId, checkIn, checkOut: next, guests })
  }

  function changeUnit(next: string) {
    setUnitId(next)
    schedulePreview({ unitId: next, checkIn, checkOut, guests })
  }

  function changeGuests(next: string) {
    setGuests(next)
    schedulePreview({ unitId, checkIn, checkOut, guests: next })
  }

  async function handle(formData: FormData) {
    setPending(true)
    const res = await createManualReservation(formData)
    setPending(false)
    if (res.ok) {
      toast.success("Reserva creada.")
      reset()
      setOpen(false)
      router.refresh()
      if (res.id) router.push(`/reservas/${res.id}`)
    } else {
      toast.error(res.error ?? "No se pudo crear la reserva.")
    }
  }

  const systemPrice =
    preview !== null && preview !== "loading" && preview.ok ? preview.total : null
  const systemCurrency =
    preview !== null && preview !== "loading" && preview.ok ? preview.currency : "ARS"

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset()
        setOpen(next)
      }}
    >
      <DialogTrigger className={buttonVariants()}>
        <Plus /> Nueva reserva
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva reserva (carga manual)</DialogTitle>
          <DialogDescription>
            Se valida disponibilidad en la base; si las fechas están ocupadas, se rechaza.
          </DialogDescription>
        </DialogHeader>

        <form action={handle} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="unit_id">Unidad</Label>
            <select
              id="unit_id"
              name="unit_id"
              required
              className={selectCls}
              value={unitId}
              onChange={(event) => changeUnit(event.target.value)}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} (hasta {u.capacity}p)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="check_in">Ingreso</Label>
              <DateField id="check_in" name="check_in" value={checkIn} onValueChange={changeCheckIn} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="check_out">Salida</Label>
              <DateField
                id="check_out"
                name="check_out"
                orderNotice={false}
                min={checkIn ? addDays(checkIn, 1) : undefined}
                value={checkOut}
                onValueChange={changeCheckOut}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="guests">Huéspedes</Label>
              <Input
                id="guests"
                name="guests"
                type="number"
                min={1}
                value={guests}
                onChange={(event) => changeGuests(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="status">Estado inicial</Label>
              <select id="status" name="status" className={selectCls} defaultValue="confirmed">
                <option value="confirmed">Confirmada</option>
                <option value="pending">Pendiente</option>
                <option value="inquiry">Consulta</option>
              </select>
            </div>
          </div>

          {canSetPrice && (
            <SpecialPriceFields
              systemPrice={systemPrice}
              loading={preview === "loading"}
              currency={systemCurrency}
              idPrefix="new"
            />
          )}

          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Huésped</p>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="full_name">Nombre y apellido</Label>
                <Input id="full_name" name="full_name" required placeholder="Juan Pérez" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" placeholder="juan@mail.com" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input id="phone" name="phone" placeholder="+54 9 351…" />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="notes">Observaciones</Label>
            <Textarea id="notes" name="notes" rows={2} placeholder="Llega tarde, mascota, etc." />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear reserva"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
