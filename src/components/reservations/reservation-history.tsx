"use client"

import * as React from "react"
import { History } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
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
import { DEFAULT_TIMEZONE } from "@/lib/format"
import { describeAudit, type AuditEntry } from "@/lib/reservation-rules"
import { getReservationAudit } from "@/app/(panel)/reservas/actions"

const when = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: DEFAULT_TIMEZONE }).format(new Date(iso))

/** Lo que se editó, canceló, reabrió o eliminó, con quién y cuándo. */
export function AuditList({ entries, showCode = true }: { entries: AuditEntry[]; showCode?: boolean }) {
  if (entries.length === 0) {
    return <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">Todavía no hay cambios registrados.</p>
  }
  return (
    <ul className="divide-y rounded-lg border">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="grid gap-0.5 px-3 py-2.5 text-sm">
          <p className="label-mono text-muted-foreground">
            {when(entry.at)} · {entry.actor_name}
            {showCode && <> · {entry.reservation_code}</>}
          </p>
          <p>{describeAudit(entry)}</p>
        </li>
      ))}
    </ul>
  )
}

/** Historial de cambios de todas las reservas del complejo (dueño o administrador). */
export function ReservationHistoryDialog() {
  const [entries, setEntries] = React.useState<AuditEntry[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function load() {
    setEntries(null)
    setError(null)
    const result = await getReservationAudit()
    if (result.ok) setEntries(result.entries)
    else setError(result.error)
  }

  return (
    <Dialog onOpenChange={(open) => open && load()}>
      <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <History /> Historial de cambios
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Historial de cambios</DialogTitle>
          <DialogDescription>
            Las reservas que se editaron, cancelaron, reabrieron o eliminaron, con quién lo hizo. Incluye las
            eliminadas, que ya no aparecen en el listado.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : entries === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <AuditList entries={entries} />
        )}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
