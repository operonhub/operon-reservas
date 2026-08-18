import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/format"
import { ENTER_UP, stagger } from "@/lib/motion"
import { RateDialog } from "@/components/rates/rate-dialog"
import { RateDeleteButton } from "@/components/rates/rate-delete-button"
import { RateActiveToggle } from "@/components/rates/rate-active-toggle"
import {
  RULE_PRESETS, presetOf, describeRule, priorityLabel, type RateRow,
} from "@/lib/rate-rules"
import { Plus, Moon, TriangleAlert } from "lucide-react"

type Unit = { id: string; name: string; capacity: number }

export function UnitRatesCard({
  unit,
  base,
  baseIsInherited,
  rules,
  units,
  propertyId,
  currency,
  index,
}: {
  unit: Unit
  base: RateRow | null
  baseIsInherited: boolean
  rules: RateRow[]
  units: Unit[]
  propertyId: string
  currency: string
  index: number
}) {
  const active = rules.filter((r) => r.is_active)

  return (
    <article
      className={cn(ENTER_UP, "flex flex-col overflow-hidden rounded-2xl border bg-card")}
      style={stagger(index, 60)}
    >
      <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-lg font-semibold tracking-tight">
            {unit.name}
          </h2>
          <p className="label-mono mt-0.5 text-muted-foreground">
            hasta {unit.capacity} huéspedes
          </p>
        </div>
        <RateDialog
          mode="new"
          units={units}
          propertyId={propertyId}
          defaultUnitId={unit.id}
          triggerLabel="Regla"
          triggerIcon={<Plus />}
          triggerVariant="outline"
          triggerSize="sm"
        />
      </header>

      {/* Precio base: el dato que se consulta a diario */}
      <div className="px-5 py-5">
        {base ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="label-mono text-muted-foreground">
                Precio base
                {baseIsInherited && " · heredado de la propiedad"}
              </p>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums">
                {formatCurrency(base.price_per_night, base.currency ?? currency)}
                <span className="ml-1 text-base font-normal text-muted-foreground">
                  /noche
                </span>
              </p>
              {base.min_nights > 1 && (
                <p className="label-mono mt-1.5 flex items-center gap-1 text-muted-foreground">
                  <Moon className="size-3" /> mínimo {base.min_nights} noches
                </p>
              )}
            </div>
            <RateDialog
              mode="edit"
              rate={base}
              units={units}
              propertyId={propertyId}
              triggerLabel="Editar base"
              triggerVariant="ghost"
              triggerSize="sm"
            />
          </div>
        ) : (
          // Sin base no hay precio posible: la reserva se crea en $0 y eso
          // pasa desapercibido hasta que alguien reserva.
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/50 bg-warning/15 px-4 py-3">
            <p className="flex items-center gap-2 text-sm">
              <TriangleAlert className="size-4 shrink-0" />
              Sin precio base: las reservas de esta unidad quedan sin importe.
            </p>
            <RateDialog
              mode="new"
              units={units}
              propertyId={propertyId}
              defaultUnitId={unit.id}
              defaultPreset="base"
              triggerLabel="Definir precio"
              triggerSize="sm"
            />
          </div>
        )}
      </div>

      {/* Reglas de esa unidad */}
      <div className="mt-auto border-t px-5 py-4">
        <p className="label-mono mb-2.5 text-muted-foreground">
          Reglas {active.length > 0 && `· ${active.length} activas`}
        </p>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin reglas: se cobra el precio base todas las noches.
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <RuleLine
                key={r.id}
                rule={r}
                units={units}
                propertyId={propertyId}
                currency={currency}
                base={base}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/** Una regla: qué hace, cuándo aplica y cuánto termina costando. */
export function RuleLine({
  rule,
  units,
  propertyId,
  currency,
  base,
}: {
  rule: RateRow
  units: Unit[]
  propertyId: string
  currency: string
  base?: RateRow | null
}) {
  const preset = presetOf(rule)
  const def = RULE_PRESETS[preset]
  const Icon = def.icon

  // El efecto se muestra ya resuelto en pesos cuando se puede: un "−15%"
  // suelto obliga a hacer la cuenta de cabeza.
  const resolved =
    rule.discount_pct != null && base?.price_per_night != null
      ? Math.round(Number(base.price_per_night) * (1 - rule.discount_pct / 100))
      : rule.price_per_night != null
        ? Number(rule.price_per_night)
        : null

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2.5",
        !rule.is_active && "opacity-55"
      )}
    >
      <span
        className={cn(
          "label-mono flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1",
          def.className
        )}
      >
        <Icon className="size-3" />
        {def.label}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {rule.label || def.label}
        </span>
        <span className="label-mono text-muted-foreground">
          {describeRule(rule)}
          {rule.priority > 0 && ` · prioridad ${priorityLabel(rule.priority).toLowerCase()}`}
        </span>
      </span>

      <span className="text-right">
        {rule.discount_pct != null && (
          <span className="block font-mono text-sm font-semibold tabular-nums text-success">
            −{rule.discount_pct}%
          </span>
        )}
        {resolved != null && (
          <span
            className={cn(
              "block font-mono tabular-nums",
              rule.discount_pct != null
                ? "text-[11px] text-muted-foreground"
                : "text-sm font-semibold"
            )}
          >
            {formatCurrency(resolved, rule.currency ?? currency)}
          </span>
        )}
      </span>

      <span className="flex items-center gap-0.5">
        <RateActiveToggle id={rule.id} isActive={rule.is_active} />
        <RateDialog
          mode="edit"
          rate={rule}
          units={units}
          propertyId={propertyId}
          triggerLabel="Editar"
          triggerVariant="ghost"
          triggerSize="sm"
        />
        <RateDeleteButton id={rule.id} />
      </span>
    </div>
  )
}
