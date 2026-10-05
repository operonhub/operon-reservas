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
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/format"
import { saveGuestPrices } from "@/app/(panel)/tarifas/actions"
import {
  applyGuestPrice, draftsFor, parseDrafts, peopleLabel, tierChangePct,
  type GuestTier, type TierDraft,
} from "@/lib/guest-prices"
import { Users } from "lucide-react"

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * Precio según la cantidad de personas de una unidad: una fila por cantidad,
 * con el precio que termina pagando al lado. Se guarda todo junto.
 */
export function GuestPricesDialog({
  unit,
  basePrice,
  currency,
  tiers,
  triggerLabel,
}: {
  unit: { id: string; name: string; capacity: number }
  basePrice: number | null
  currency: string
  tiers: GuestTier[]
  triggerLabel: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [drafts, setDrafts] = React.useState<TierDraft[]>(() => draftsFor(unit.capacity, tiers))
  const money = (n: number) => formatCurrency(n, currency)

  function change(guests: number, patch: Partial<TierDraft>) {
    setDrafts((rows) => rows.map((r) => (r.guests === guests ? { ...r, ...patch } : r)))
  }

  async function save() {
    const parsed = parseDrafts(drafts, unit.capacity)
    if ("error" in parsed) {
      toast.error(parsed.error)
      return
    }
    setPending(true)
    const res = await saveGuestPrices(unit.id, parsed.tiers)
    setPending(false)
    if (res.ok) {
      toast.success(parsed.tiers.length ? "Precio según personas guardado." : "Vuelve a cobrar lo mismo para cualquier cantidad.")
      setOpen(false)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo guardar.")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Al abrir, parte siempre de lo guardado: un cambio descartado no queda a medias.
        if (next) setDrafts(draftsFor(unit.capacity, tiers))
        setOpen(next)
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" /> Precio según personas · {unit.name}
          </DialogTitle>
          <DialogDescription>
            Cobrá menos cuando se alojan menos personas. Se aplica sobre el precio de cada noche,
            también en temporadas y fechas especiales.
          </DialogDescription>
        </DialogHeader>

        {basePrice == null && (
          <p className="rounded-lg bg-warning/20 px-3 py-2 text-sm">
            Esta unidad no tiene precio base: cargalo primero para ver cuánto queda cada opción.
          </p>
        )}

        <ul className="grid gap-3">
          {drafts.map((d) => {
            const value = Number(String(d.value).replace(",", "."))
            const valid = d.mode !== "full" && Number.isFinite(value) && value > 0 && (d.mode === "fixed" || value < 100)
            const tier = valid ? { guests: d.guests, mode: d.mode as GuestTier["mode"], value } : null
            const result = basePrice != null ? applyGuestPrice(basePrice, basePrice, tier) : null
            const pct = tier && d.mode === "fixed" ? tierChangePct(tier, basePrice) : null
            return (
              <li key={d.guests} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[6.5rem_1fr_7rem] sm:items-center">
                <p className="text-sm font-medium">{peopleLabel(d.guests)}</p>
                <div className="grid grid-cols-[1fr_6.5rem] gap-2">
                  <select
                    aria-label={`Precio para ${peopleLabel(d.guests)}`}
                    value={d.mode}
                    onChange={(e) => change(d.guests, { mode: e.target.value as TierDraft["mode"], value: "" })}
                    className={cn(selectCls, d.mode === "full" && "col-span-2")}
                  >
                    <option value="full">Precio completo</option>
                    <option value="percent">% menos</option>
                    <option value="fixed">Precio fijo</option>
                  </select>
                  {d.mode !== "full" && (
                    <Input
                      aria-label={d.mode === "percent" ? `Porcentaje para ${peopleLabel(d.guests)}` : `Precio por noche para ${peopleLabel(d.guests)}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={d.value}
                      onChange={(e) => change(d.guests, { value: e.target.value })}
                      placeholder={d.mode === "percent" ? "20" : "100000"}
                    />
                  )}
                </div>
                <p className="text-sm sm:text-right">
                  {result != null ? (
                    <>
                      <span className="font-mono font-semibold tabular-nums">{money(result)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {d.mode === "full" || !tier
                          ? "por noche"
                          : pct != null && pct !== 0
                            ? `por noche · ${Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: 1 })}% ${pct < 0 ? "menos" : "más"}`
                            : "por noche"}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          <strong>% menos</strong> descuenta ese porcentaje de cada noche. <strong>Precio fijo</strong> es lo que
          cuesta una noche a precio base; en una fecha con otro precio (temporada, fin de semana largo) se
          mantiene la misma proporción.
        </p>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
