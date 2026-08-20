"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { createRate, updateRate } from "@/app/(panel)/tarifas/actions"
import {
  RULE_PRESETS, CREATABLE_PRESETS, WEEKDAYS, PRIORITY_LEVELS,
  presetOf, type RulePreset, type RateRow,
} from "@/lib/rate-rules"

type Unit = { id: string; name: string }

export function RateDialog({
  mode,
  rate,
  units,
  propertyId,
  defaultUnitId,
  defaultPreset,
  triggerLabel,
  triggerVariant = "default",
  triggerSize = "default",
  triggerIcon,
  triggerClassName,
}: {
  mode: "new" | "edit"
  rate?: RateRow
  units: Unit[]
  propertyId: string
  defaultUnitId?: string | null
  defaultPreset?: RulePreset
  triggerLabel: string
  triggerVariant?: "default" | "outline" | "ghost" | "secondary"
  triggerSize?: "default" | "sm"
  triggerIcon?: React.ReactNode
  triggerClassName?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  const initialPreset: RulePreset =
    mode === "edit" && rate ? presetOf(rate) : (defaultPreset ?? "temporada")
  const [preset, setPreset] = React.useState<RulePreset>(initialPreset)

  const def = RULE_PRESETS[preset]
  const shows = (f: string) => def.fields.includes(f as never)

  const [weekdays, setWeekdays] = React.useState<number[]>(
    rate?.weekdays ?? RULE_PRESETS[initialPreset].defaultWeekdays ?? []
  )

  // Al cambiar de preset se reponen los días sugeridos de ese preset.
  function pickPreset(next: RulePreset) {
    setPreset(next)
    setWeekdays(rate?.weekdays ?? RULE_PRESETS[next].defaultWeekdays ?? [])
  }

  async function handle(formData: FormData) {
    setPending(true)
    const res = mode === "new" ? await createRate(formData) : await updateRate(formData)
    setPending(false)
    if (res.ok) {
      toast.success(mode === "new" ? "Regla creada." : "Regla actualizada.")
      setOpen(false)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo guardar.")
    }
  }

  const isBase = preset === "base"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          buttonVariants({ variant: triggerVariant, size: triggerSize }),
          triggerClassName
        )}
      >
        {triggerIcon}
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isBase
              ? mode === "new"
                ? "Definir precio base"
                : "Editar precio base"
              : mode === "new"
                ? "Nueva regla de precio"
                : "Editar regla"}
          </DialogTitle>
          <DialogDescription>{def.hint}</DialogDescription>
        </DialogHeader>

        <form action={handle} className="grid gap-4">
          {mode === "edit" && <input type="hidden" name="id" value={rate!.id} />}
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="preset" value={preset} />
          <input type="hidden" name="weekdays" value={weekdays.join(",")} />

          {/* Selector de tipo: sólo al crear y sólo si no es la base */}
          {mode === "new" && !isBase && (
            <div className="grid gap-1.5">
              <Label className="label-mono text-muted-foreground">Tipo de regla</Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {CREATABLE_PRESETS.map((k) => {
                  const p = RULE_PRESETS[k]
                  const on = preset === k
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => pickPreset(k)}
                      aria-pressed={on}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-all",
                        on
                          ? "border-primary bg-primary/10 font-medium text-foreground"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      )}
                    >
                      <p.icon className="size-3.5 shrink-0" />
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* El precio base es uno solo por unidad: ponerle nombre no aporta
              nada. El nombre sirve para distinguir promos entre sí. */}
          {!isBase && (
            <div className="grid gap-1.5">
              <Label htmlFor="label" className="label-mono text-muted-foreground">
                Nombre <span className="text-muted-foreground/70">(opcional)</span>
              </Label>
              <Input
                id="label"
                name="label"
                defaultValue={rate?.label ?? ""}
                placeholder="Vacaciones de invierno"
              />
            </div>
          )}

          {/* Unidad: la base siempre es por unidad; el resto puede ser global */}
          <div className="grid gap-1.5">
            <Label htmlFor="unit_id" className="label-mono text-muted-foreground">
              Aplica a
            </Label>
            <select
              id="unit_id"
              name="unit_id"
              defaultValue={rate?.unit_id ?? defaultUnitId ?? ""}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Todas las unidades</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          {shows("price") && (
            <div className="grid gap-1.5">
              <Label htmlFor="price_per_night" className="label-mono text-muted-foreground">
                Precio por noche
                {shows("discount") && " (o dejalo vacío y usá el descuento)"}
              </Label>
              <Input
                id="price_per_night"
                name="price_per_night"
                type="number"
                min={0}
                step="any"
                defaultValue={rate?.price_per_night ?? ""}
                placeholder="90000"
              />
            </div>
          )}

          {shows("discount") && (
            <div className="grid gap-1.5">
              <Label htmlFor="discount_pct" className="label-mono text-muted-foreground">
                Descuento (%)
              </Label>
              <Input
                id="discount_pct"
                name="discount_pct"
                type="number"
                min={1}
                max={100}
                step="1"
                defaultValue={rate?.discount_pct ?? ""}
                placeholder="15"
              />
            </div>
          )}

          {shows("weekdays") && (
            <div className="grid gap-1.5">
              <Label className="label-mono text-muted-foreground">Días</Label>
              <div className="flex gap-1">
                {WEEKDAYS.map((d) => {
                  const on = weekdays.includes(d.value)
                  return (
                    <button
                      key={d.value}
                      type="button"
                      title={d.label}
                      aria-pressed={on}
                      onClick={() =>
                        setWeekdays((prev) =>
                          prev.includes(d.value)
                            ? prev.filter((x) => x !== d.value)
                            : [...prev, d.value]
                        )
                      }
                      className={cn(
                        "size-8 rounded-lg border text-xs font-medium transition-all",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      {d.short}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {shows("minNightsRule") && (
            <div className="grid gap-1.5">
              <Label htmlFor="min_nights_rule" className="label-mono text-muted-foreground">
                A partir de cuántas noches
              </Label>
              <Input
                id="min_nights_rule"
                name="min_nights_rule"
                type="number"
                min={2}
                step="1"
                defaultValue={rate?.min_nights_rule ?? 7}
              />
            </div>
          )}

          {shows("guests") && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="min_guests" className="label-mono text-muted-foreground">
                  Desde (huéspedes)
                </Label>
                <Input
                  id="min_guests"
                  name="min_guests"
                  type="number"
                  min={1}
                  defaultValue={rate?.min_guests ?? ""}
                  placeholder="1"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="max_guests" className="label-mono text-muted-foreground">
                  Hasta (huéspedes)
                </Label>
                <Input
                  id="max_guests"
                  name="max_guests"
                  type="number"
                  min={1}
                  defaultValue={rate?.max_guests ?? ""}
                  placeholder="2"
                />
              </div>
            </div>
          )}

          {shows("dates") && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="start_date" className="label-mono text-muted-foreground">
                  Desde {!isBase && "(opcional)"}
                </Label>
                <Input
                  id="start_date"
                  name="start_date"
                  type="date"
                  defaultValue={rate?.start_date ?? ""}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="end_date" className="label-mono text-muted-foreground">
                  Hasta {!isBase && "(opcional)"}
                </Label>
                <Input
                  id="end_date"
                  name="end_date"
                  type="date"
                  defaultValue={rate?.end_date ?? ""}
                />
              </div>
            </div>
          )}

          {shows("minNights") && (
            <div className="grid gap-1.5">
              <Label htmlFor="min_nights" className="label-mono text-muted-foreground">
                Estadía mínima (noches)
              </Label>
              <Input
                id="min_nights"
                name="min_nights"
                type="number"
                min={1}
                defaultValue={rate?.min_nights ?? 1}
              />
              <p className="text-[11px] text-muted-foreground">
                Se rechaza toda reserva más corta, tanto desde la web como
                cargada a mano.
              </p>
            </div>
          )}

          {!isBase && (
            <div className="grid gap-1.5">
              <Label htmlFor="priority" className="label-mono text-muted-foreground">
                Prioridad
              </Label>
              <select
                id="priority"
                name="priority"
                defaultValue={rate?.priority ?? 0}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {PRIORITY_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label} — {l.hint}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Si dos reglas caen en la misma noche, gana la de mayor prioridad.
              </p>
            </div>
          )}

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
