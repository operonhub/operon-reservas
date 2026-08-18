"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, todayISO, addDays } from "@/lib/format"
import { simulatePrice, type SimulationResult } from "@/app/(panel)/tarifas/simulate"
import { Calculator, TriangleAlert, Loader2 } from "lucide-react"

type Unit = { id: string; name: string }

const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]

/**
 * Simulador de precios: muestra cuánto sale una estadía y QUÉ REGLA gobernó
 * cada noche.
 *
 * Es la forma de que el propietario entienda sus propias reglas sin tener que
 * crear una reserva de prueba, y hace visible el prorrateo por temporada —
 * que antes fallaba en silencio y cobraba de menos.
 */
export function PriceSimulator({ units }: { units: Unit[] }) {
  const [unitId, setUnitId] = React.useState(units[0]?.id ?? "")
  const [checkIn, setCheckIn] = React.useState(addDays(todayISO(), 7))
  const [checkOut, setCheckOut] = React.useState(addDays(todayISO(), 10))
  const [guests, setGuests] = React.useState(2)
  const [result, setResult] = React.useState<SimulationResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function run() {
    setPending(true)
    setError(null)
    const res = await simulatePrice(unitId, checkIn, checkOut, guests)
    setPending(false)
    if (res.ok) {
      setResult(res.data)
    } else {
      setResult(null)
      setError(res.error)
    }
  }

  const nights = result?.breakdown.length ?? 0
  const belowMin = result != null && result.nights < result.min_nights

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Calculator className="size-4" />
        </span>
        Simulador
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Probá una estadía y mirá qué precio le corresponde a cada noche.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="sim-unit" className="label-mono text-muted-foreground">
            Unidad
          </Label>
          <select
            id="sim-unit"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sim-in" className="label-mono text-muted-foreground">
            Ingreso
          </Label>
          <Input
            id="sim-in"
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sim-out" className="label-mono text-muted-foreground">
            Salida
          </Label>
          <Input
            id="sim-out"
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sim-guests" className="label-mono text-muted-foreground">
            Personas
          </Label>
          <Input
            id="sim-guests"
            type="number"
            min={1}
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value) || 1)}
            className="w-20"
          />
        </div>
        <Button onClick={run} disabled={pending || !unitId}>
          {pending ? <Loader2 className="animate-spin" /> : <Calculator />}
          Calcular
        </Button>
      </div>

      {error && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <div className="mt-5 space-y-3">
          {belowMin && (
            <p className="flex items-center gap-2 rounded-lg bg-warning/20 px-3 py-2.5 text-sm">
              <TriangleAlert className="size-4 shrink-0" />
              Esta estadía es de {result.nights}{" "}
              {result.nights === 1 ? "noche" : "noches"} y el mínimo configurado
              es {result.min_nights}: se rechazaría al reservar.
            </p>
          )}

          <ul className="divide-y overflow-hidden rounded-xl border">
            {result.breakdown.map((n) => {
              const changed = n.rule != null
              return (
                <li
                  key={n.day}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono tabular-nums">{n.day}</span>
                    <span className="label-mono text-muted-foreground">
                      {WEEKDAY_SHORT[new Date(n.day + "T00:00:00").getDay()]}
                    </span>
                    {changed && (
                      <span className="truncate rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium">
                        {n.rule!.label ?? "Regla"}
                        {n.rule!.discount_pct != null && ` −${n.rule!.discount_pct}%`}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      n.price == null && "text-destructive"
                    )}
                  >
                    {n.price == null
                      ? "sin tarifa"
                      : formatCurrency(n.price, result.currency)}
                  </span>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3">
            <span className="text-sm font-medium">
              Total · {nights} {nights === 1 ? "noche" : "noches"}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {result.total == null
                ? "—"
                : formatCurrency(result.total, result.currency)}
            </span>
          </div>
          {result.total == null && (
            <p className="text-xs text-muted-foreground">
              Alguna noche no tiene tarifa base definida, así que la reserva se
              crearía sin precio. Cargá un precio base para esta unidad.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
