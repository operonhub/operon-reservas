"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency } from "@/lib/format"
import { parseAmount } from "@/lib/guest-prices"

/**
 * Precio especial de una reserva (0047). El precio del sistema se muestra
 * siempre como referencia y el campo vacío significa "cobrar lo del sistema".
 *
 * El $0 se puede, pero con doble candado: hay que escribir el motivo y tildar
 * la confirmación. Es el único valor que podría ser un error de carga y no una
 * decisión, así que no se guarda por accidente.
 */
export function SpecialPriceFields({
  systemPrice,
  currency,
  initialOverride = null,
  initialNote = null,
  idPrefix,
  loading = false,
}: {
  systemPrice: number | null
  currency: string
  initialOverride?: number | null
  initialNote?: string | null
  idPrefix: string
  loading?: boolean
}) {
  const [raw, setRaw] = React.useState(initialOverride == null ? "" : String(initialOverride))
  const [note, setNote] = React.useState(initialNote ?? "")

  const parsed = raw.trim() === "" ? null : parseAmount(raw, "fixed")
  const invalid = parsed != null && !Number.isFinite(parsed)
  const value = parsed != null && Number.isFinite(parsed) ? parsed : null
  const isFree = value === 0
  // Una reserva que YA estaba sin cargo no vuelve a pedir la confirmación en
  // cada edición: el candado es para el momento en que se pone en cero.
  const wasFree = initialOverride === 0
  const needsFreeConfirmation = isFree && !wasFree
  const diff = value != null && systemPrice != null ? value - systemPrice : null
  const pct = diff != null && systemPrice ? Math.round((diff / systemPrice) * 1000) / 10 : null
  const suspicious =
    value != null && value > 0 && systemPrice != null && systemPrice > 0 && value < systemPrice * 0.1

  function blur() {
    if (value == null) return
    setRaw(value.toLocaleString("es-AR", { maximumFractionDigits: 2 }))
  }

  return (
    <div className="grid gap-3 border-t pt-3">
      <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Precio del sistema</span>
        <span className="font-mono font-medium tabular-nums">
          {loading ? "Calculando…" : systemPrice == null ? "Sin tarifa" : formatCurrency(systemPrice, currency)}
        </span>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}_total_override`}>
          Precio especial <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id={`${idPrefix}_total_override`}
          name="total_override"
          inputMode="decimal"
          placeholder={systemPrice == null ? "Ej. 300.000" : `Vacío: ${formatCurrency(systemPrice, currency)}`}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          onBlur={blur}
          aria-invalid={invalid || undefined}
          aria-describedby={`${idPrefix}_price_hint`}
        />
        {invalid ? (
          <p id={`${idPrefix}_price_hint`} className="text-xs font-medium text-destructive">
            No se entiende ese precio. Escribilo como 300.000 o 300000.
          </p>
        ) : diff != null && diff !== 0 ? (
          <p id={`${idPrefix}_price_hint`} className="text-xs text-muted-foreground">
            {diff < 0 ? "Bonificás" : "Aumentás"} {formatCurrency(Math.abs(diff), currency)}
            {pct != null && <> · {Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</>}
            {systemPrice != null && <> sobre {formatCurrency(systemPrice, currency)}</>}.
          </p>
        ) : (
          <p id={`${idPrefix}_price_hint`} className="text-xs text-muted-foreground">
            Dejalo vacío para cobrar el precio que calculan las tarifas.
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}_price_note`}>
          Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id={`${idPrefix}_price_note`}
          name="price_note"
          placeholder="Familia, amigo, canje…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={120}
          required={needsFreeConfirmation}
        />
      </div>

      {isFree && (
        <div className="grid gap-2 rounded-lg bg-warning/20 p-3 text-xs">
          <p className="text-sm font-semibold">Estadía sin cargo</p>
          <p>
            {wasFree
              ? "Esta reserva ya está sin cargo. Si querés volver a cobrarla, escribí un precio."
              : "El total de la reserva queda en $0 y la seña también. Escribí el motivo y confirmá que es una decisión, no una carga rápida."}
          </p>
          {needsFreeConfirmation && (
            <label className="flex items-start gap-2 font-medium">
              <input type="checkbox" name="confirm_free" required className="mt-0.5 size-4" />
              Confirmo que es una invitación, un canje o una estadía sin cargo
            </label>
          )}
        </div>
      )}

      {suspicious && !isFree && (
        <p className="text-xs font-medium text-destructive">
          Es menos del 10% del precio del sistema. Revisá que no falten ceros.
        </p>
      )}
    </div>
  )
}
