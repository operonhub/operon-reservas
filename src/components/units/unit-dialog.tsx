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
import { UnitPhotoField } from "@/components/units/unit-photo-field"
import { AmenitiesField } from "@/components/units/amenities-field"
import { createUnit, updateUnit } from "@/app/(panel)/unidades/actions"

type Unit = {
  id: string
  name: string
  description: string | null
  capacity: number
  is_active: boolean
  photo_path?: string | null
  amenities?: string[] | null
}

type Property = { id: string; name: string }

export function UnitDialog({
  mode,
  unit,
  properties,
  organizationId,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "default",
  triggerIcon,
}: {
  mode: "new" | "edit"
  unit?: Unit
  properties: Property[]
  organizationId: string
  triggerLabel: string
  triggerVariant?: "default" | "outline" | "ghost"
  triggerSize?: "default" | "sm"
  triggerIcon?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function handle(formData: FormData) {
    setPending(true)
    const res =
      mode === "new" ? await createUnit(formData) : await updateUnit(formData)
    setPending(false)
    if (res.ok) {
      toast.success(mode === "new" ? "Unidad creada." : "Unidad actualizada.")
      setOpen(false)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo guardar.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={buttonVariants({ variant: triggerVariant, size: triggerSize })}
      >
        {triggerIcon}
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "new" ? "Nueva unidad" : "Editar unidad"}
          </DialogTitle>
          <DialogDescription>
            {mode === "new"
              ? "Agregá una cabaña, loft o habitación reservable."
              : "Modificá los datos de la unidad."}
          </DialogDescription>
        </DialogHeader>

        <form action={handle} className="grid gap-5">
          {mode === "edit" && <input type="hidden" name="id" value={unit!.id} />}

          <div className="grid gap-5 sm:grid-cols-[280px_1fr]">
            {/* Columna izquierda: identidad visual de la unidad */}
            <UnitPhotoField
              organizationId={organizationId}
              unitId={unit?.id}
              initialPath={unit?.photo_path}
            />

            {/* Columna derecha: datos */}
            <div className="grid content-start gap-4">
              {mode === "new" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="property_id">Propiedad</Label>
                  {properties.length === 1 ? (
                    <>
                      <input type="hidden" name="property_id" value={properties[0].id} />
                      <p className="text-sm text-muted-foreground">{properties[0].name}</p>
                    </>
                  ) : (
                    <select
                      id="property_id"
                      name="property_id"
                      required
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  defaultValue={unit?.name}
                  placeholder="Cabaña 1"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="description">Descripción</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={unit?.description ?? ""}
                  placeholder="2 ambientes, hasta 4 personas"
                  rows={2}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="capacity">Capacidad (personas)</Label>
                <Input
                  id="capacity"
                  name="capacity"
                  type="number"
                  min={1}
                  defaultValue={unit?.capacity ?? 2}
                />
              </div>

              {mode === "edit" && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={unit?.is_active ?? true}
                    className="size-4 accent-primary"
                  />
                  Unidad activa (disponible para reservar)
                </label>
              )}
            </div>
          </div>

          <AmenitiesField initial={unit?.amenities ?? []} />

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
