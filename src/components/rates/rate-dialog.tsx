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
import { createRate, updateRate } from "@/app/(panel)/tarifas/actions"
import type { Enums } from "@/lib/supabase/types"

type Unit = { id: string; name: string }
type Rate = {
  id: string
  unit_id: string | null
  kind: Enums<"rate_kind">
  price_per_night: number
  min_nights: number
  priority: number
  start_date: string | null
  end_date: string | null
}

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

export function RateDialog({
  mode,
  rate,
  units,
  propertyId,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "default",
}: {
  mode: "new" | "edit"
  rate?: Rate
  units: Unit[]
  propertyId: string
  triggerLabel: string
  triggerVariant?: "default" | "outline" | "ghost"
  triggerSize?: "default" | "sm"
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [kind, setKind] = React.useState<Enums<"rate_kind">>(rate?.kind ?? "base")

  async function handle(formData: FormData) {
    setPending(true)
    const res = mode === "new" ? await createRate(formData) : await updateRate(formData)
    setPending(false)
    if (res.ok) {
      toast.success(mode === "new" ? "Tarifa creada." : "Tarifa actualizada.")
      setOpen(false)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo guardar.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: triggerVariant, size: triggerSize })}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "new" ? "Nueva tarifa" : "Editar tarifa"}</DialogTitle>
          <DialogDescription>
            La tarifa más específica gana: unidad &gt; propiedad, y especial/temporada &gt; base.
          </DialogDescription>
        </DialogHeader>

        <form action={handle} className="grid gap-4">
          {mode === "edit" && <input type="hidden" name="id" value={rate!.id} />}
          <input type="hidden" name="property_id" value={propertyId} />

          <div className="grid gap-1.5">
            <Label htmlFor="unit_id">Aplica a</Label>
            <select
              id="unit_id"
              name="unit_id"
              className={selectCls}
              defaultValue={rate?.unit_id ?? ""}
            >
              <option value="">Toda la propiedad</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="kind">Tipo</Label>
              <select
                id="kind"
                name="kind"
                className={selectCls}
                value={kind}
                onChange={(e) => setKind(e.target.value as Enums<"rate_kind">)}
              >
                <option value="base">Base</option>
                <option value="seasonal">Temporada</option>
                <option value="special">Fecha especial</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="price_per_night">Precio / noche</Label>
              <Input
                id="price_per_night"
                name="price_per_night"
                type="number"
                min={0}
                required
                defaultValue={rate?.price_per_night ?? ""}
              />
            </div>
          </div>

          {kind !== "base" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="start_date">Desde</Label>
                <Input id="start_date" name="start_date" type="date" defaultValue={rate?.start_date ?? ""} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="end_date">Hasta</Label>
                <Input id="end_date" name="end_date" type="date" defaultValue={rate?.end_date ?? ""} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="min_nights">Mín. noches</Label>
              <Input id="min_nights" name="min_nights" type="number" min={1} defaultValue={rate?.min_nights ?? 1} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="priority">Prioridad</Label>
              <Input id="priority" name="priority" type="number" defaultValue={rate?.priority ?? 0} />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
