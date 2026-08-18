"use client"

import * as React from "react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { AMENITIES, AMENITY_KEYS, type AmenityKey } from "@/lib/amenities"
import { Check } from "lucide-react"

/**
 * Selector de servicios. Los chips tildados se serializan a un input oculto
 * (separados por coma) para viajar en el mismo FormData que ya usan las
 * server actions de unidades — sin cambiar ese contrato.
 */
export function AmenitiesField({ initial = [] }: { initial?: string[] }) {
  const [selected, setSelected] = React.useState<Set<AmenityKey>>(
    () => new Set(initial.filter((k): k is AmenityKey => k in AMENITIES))
  )

  function toggle(key: AmenityKey) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="grid gap-1.5">
      <Label>
        Servicios
        {selected.size > 0 && (
          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
            {selected.size}
          </span>
        )}
      </Label>
      <input
        type="hidden"
        name="amenities"
        value={AMENITY_KEYS.filter((k) => selected.has(k)).join(",")}
      />

      <div className="flex flex-wrap gap-1.5">
        {AMENITY_KEYS.map((key) => {
          const { label, icon: Icon } = AMENITIES[key]
          const on = selected.has(key)
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={on}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all",
                on
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {on ? <Check className="size-3.5 text-primary" /> : <Icon className="size-3.5" />}
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
