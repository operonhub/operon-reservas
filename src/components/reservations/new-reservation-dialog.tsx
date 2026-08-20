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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createManualReservation } from "@/app/(panel)/reservas/actions"
import { Plus } from "lucide-react"

type Unit = { id: string; name: string; capacity: number }

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function NewReservationDialog({ units }: { units: Unit[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function handle(formData: FormData) {
    setPending(true)
    const res = await createManualReservation(formData)
    setPending(false)
    if (res.ok) {
      toast.success("Reserva creada.")
      setOpen(false)
      router.refresh()
      if (res.id) router.push(`/reservas/${res.id}`)
    } else {
      toast.error(res.error ?? "No se pudo crear la reserva.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants()}>
        <Plus /> Nueva reserva
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva reserva (carga manual)</DialogTitle>
          <DialogDescription>
            Se valida disponibilidad en la base; si las fechas están ocupadas, se rechaza.
          </DialogDescription>
        </DialogHeader>

        <form action={handle} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="unit_id">Unidad</Label>
            <select id="unit_id" name="unit_id" required className={selectCls}>
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
              <Input id="check_in" name="check_in" type="date" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="check_out">Salida</Label>
              <Input id="check_out" name="check_out" type="date" required />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="guests">Huéspedes</Label>
              <Input id="guests" name="guests" type="number" min={1} defaultValue={2} />
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
