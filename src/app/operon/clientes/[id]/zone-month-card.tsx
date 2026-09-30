"use client"

import * as React from "react"
import { toast } from "sonner"
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  TONE_CLASSES,
  canQueue,
  editionStatus,
  zoneLabel,
  type ZoneEdition,
  type ZoneOverview,
} from "@/lib/operon/zone"
import { ERRORS } from "@/lib/zone-month/content"
import { cn } from "@/lib/utils"
import { generateZoneMonth, setZoneMonth, type ZoneMonthState } from "./actions"

const monthName = (month: string) =>
  new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(new Date(`${month}T12:00:00Z`))

export function ZoneMonthCard({
  orgId,
  overview,
  suspended,
  globalEnabled,
  months,
  now,
}: {
  orgId: string
  overview: ZoneOverview | null
  suspended: boolean
  /** ZONE_MONTH_ENABLED en Vercel: sin él no se genera ni se muestra nada. */
  globalEnabled: boolean
  months: { current: string; next: string }
  now: number
}) {
  const enabled = Boolean(overview?.enabled_at)

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {enabled ? "Activado para este cliente." : "Desactivado: el cliente no ve la sección."}
        </p>
        <ToggleButton orgId={orgId} enabled={enabled} disabled={!enabled && suspended} />
      </div>

      {!globalEnabled && (
        <p className="rounded-lg bg-warning/20 p-2.5 text-xs">
          El interruptor general está apagado en Vercel (ZONE_MONTH_ENABLED): aunque lo actives acá,
          el cliente no ve la sección y no se genera nada hasta prenderlo.
        </p>
      )}

      {enabled && overview && overview.zones.length === 0 && (
        <p className="text-xs text-muted-foreground">
          El complejo no tiene una ciudad y un país válidos: no hay edición para generar.
        </p>
      )}

      {enabled &&
        overview?.zones.map((z) => (
          <div key={z.zone} className="rounded-xl border p-3">
            <p className="font-medium">{zoneLabel(z.zone)}</p>
            <ul className="mt-2 space-y-2">
              {(
                [
                  [months.current, z.current],
                  [months.next, z.next],
                ] as const
              ).map(([month, edition]) => (
                <EditionRow
                  key={month}
                  orgId={orgId}
                  zone={z.zone}
                  month={month}
                  edition={edition}
                  now={now}
                  disabled={suspended}
                />
              ))}
            </ul>
          </div>
        ))}

      {enabled && overview && overview.zones.length > 0 && (
        <p className="text-xs text-muted-foreground">
          La edición es por ciudad: la comparten todos los clientes de esa zona. Generar tarda hasta
          un minuto.
        </p>
      )}
    </div>
  )
}

function ToggleButton({ orgId, enabled, disabled }: { orgId: string; enabled: boolean; disabled: boolean }) {
  const [, formAction, pending] = React.useActionState<ZoneMonthState, FormData>(async (prev, formData) => {
    const result = await setZoneMonth(prev, formData)
    if (result?.error) toast.error(result.error)
    else if (result?.message) toast.success(result.message)
    return result
  }, null)

  return (
    <form action={formAction}>
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
      <Button
        type="submit"
        size="sm"
        variant={enabled ? "outline" : "default"}
        disabled={pending || disabled}
        title={disabled ? "El complejo está suspendido" : undefined}
      >
        {pending && <LoaderCircle className="animate-spin" />}
        {enabled ? "Desactivar" : "Activar"}
      </Button>
    </form>
  )
}

function EditionRow({
  orgId,
  zone,
  month,
  edition,
  now,
  disabled,
}: {
  orgId: string
  zone: string
  month: string
  edition: ZoneEdition | null
  now: number
  disabled: boolean
}) {
  const status = editionStatus(edition, now)
  const [, formAction, pending] = React.useActionState<ZoneMonthState, FormData>(async (prev, formData) => {
    const result = await generateZoneMonth(prev, formData)
    if (result?.error) toast.error(result.error)
    else if (result?.message) toast.success(result.message)
    return result
  }, null)
  const retry = edition?.status === "failed" || edition?.status === "processing"

  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <span className="capitalize">{monthName(month)}</span>
        <span className={cn("label-mono ml-2 rounded-md px-1.5 py-0.5", TONE_CLASSES[status.tone])}>
          {status.label}
        </span>
        {edition?.status === "failed" && edition.error_code && (
          <p className="mt-0.5 text-xs text-muted-foreground">{ERRORS[edition.error_code] ?? edition.error_code}</p>
        )}
      </div>
      {canQueue(edition, now) && (
        <form action={formAction}>
          <input type="hidden" name="org" value={orgId} />
          <input type="hidden" name="zone" value={zone} />
          <input type="hidden" name="month" value={month} />
          <Button type="submit" size="sm" variant="ghost" disabled={pending || disabled}>
            {pending ? <LoaderCircle className="animate-spin" /> : retry ? <RefreshCw /> : <Sparkles />}
            {pending ? "Generando…" : retry ? "Reintentar" : "Generar ahora"}
          </Button>
        </form>
      )}
    </li>
  )
}
