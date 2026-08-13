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
import { cn } from "@/lib/utils"
import { addDays, formatDay } from "@/lib/format"
import { OCCUPANCY_LEGEND, type CellState } from "@/lib/constants"
import { createBlock, deleteBlock } from "@/app/(panel)/calendario/actions"
import { Ban, Plus } from "lucide-react"
import type { CalendarSegment } from "@/app/(panel)/calendario/page"

type Unit = { id: string; name: string; capacity: number }

export function AvailabilityCalendar({
  units,
  segments,
  startDate,
  days,
}: {
  units: Unit[]
  segments: CalendarSegment[]
  startDate: string
  days: number
}) {
  const dayList = React.useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(startDate, i)),
    [startDate, days]
  )

  // índice: unitId -> día -> segmento que lo cubre
  const index = React.useMemo(() => {
    const map = new Map<string, CalendarSegment>()
    for (const s of segments) {
      for (let d = s.start; d < s.endExclusive; d = addDays(d, 1)) {
        if (d >= startDate) map.set(`${s.unitId}|${d}`, s)
      }
    }
    return map
  }, [segments, startDate])

  if (units.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No hay unidades activas. Cargalas en la sección Unidades.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {OCCUPANCY_LEGEND.map((l) => (
            <span key={l.state} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-3 rounded-sm", l.swatch)} />
              {l.label}
            </span>
          ))}
        </div>
        <BlockDialog units={units} startDate={startDate} />
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b bg-card px-3 py-2 text-left font-medium">
                Unidad
              </th>
              {dayList.map((d) => {
                const wd = new Date(d + "T00:00:00").toLocaleDateString("es-AR", {
                  weekday: "narrow",
                })
                return (
                  <th
                    key={d}
                    className="border-b border-l px-1 py-1 text-center font-normal text-muted-foreground"
                    title={d}
                  >
                    <div className="tabular-nums">{d.slice(8, 10)}</div>
                    <div className="text-[10px] uppercase">{wd}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td className="sticky left-0 z-10 border-b bg-card px-3 py-2 font-medium whitespace-nowrap">
                  {u.name}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ·{u.capacity}p
                  </span>
                </td>
                {dayList.map((d) => {
                  const seg = index.get(`${u.id}|${d}`)
                  const state: CellState = seg
                    ? seg.kind === "block"
                      ? "blocked"
                      : "reserved"
                    : "available"
                  return (
                    <DayCell key={d} unitName={u.name} day={d} state={state} segment={seg} />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DayCell({
  unitName,
  day,
  state,
  segment,
}: {
  unitName: string
  day: string
  state: CellState
  segment?: CalendarSegment
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  const bg =
    state === "reserved"
      ? "bg-primary/70"
      : state === "blocked"
        ? "bg-amber-500/70 cursor-pointer hover:bg-amber-500/90"
        : "bg-muted/40"

  async function onUnblock() {
    if (state !== "blocked" || !segment) return
    if (!confirm(`¿Quitar el bloqueo "${segment.label}" de ${unitName}?`)) return
    setPending(true)
    const res = await deleteBlock(segment.id)
    setPending(false)
    if (res.ok) {
      toast.success("Bloqueo eliminado.")
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo quitar el bloqueo.")
    }
  }

  return (
    <td
      className={cn("h-9 min-w-8 border-b border-l p-0 text-center", bg, pending && "opacity-50")}
      title={segment ? `${segment.label} (${segment.start} → ${segment.endExclusive})` : `${unitName} · ${day} · disponible`}
      onClick={state === "blocked" ? onUnblock : undefined}
    />
  )
}

function BlockDialog({ units, startDate }: { units: Unit[]; startDate: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function handle(formData: FormData) {
    setPending(true)
    const res = await createBlock(formData)
    setPending(false)
    if (res.ok) {
      toast.success("Fechas bloqueadas.")
      setOpen(false)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo bloquear.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
        <Ban /> Bloquear fechas
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear fechas</DialogTitle>
          <DialogDescription>
            El bloqueo resta disponibilidad igual que una reserva (mantenimiento, uso propio, etc.).
          </DialogDescription>
        </DialogHeader>

        <form action={handle} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="unit_id">Unidad</Label>
            <select
              id="unit_id"
              name="unit_id"
              required
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="start">Desde</Label>
              <Input id="start" name="start" type="date" min={startDate} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end">Hasta (excl.)</Label>
              <Input id="end" name="end" type="date" min={startDate} required />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="reason">Motivo</Label>
            <Input id="reason" name="reason" placeholder="Mantenimiento" />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={pending}>
              <Plus /> {pending ? "Bloqueando…" : "Bloquear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
