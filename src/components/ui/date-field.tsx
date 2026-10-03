"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { formatDayLong } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Campo de fecha con la fecha elegida escrita en palabras debajo.
 *
 * El control nativo ordena día y mes según el idioma del navegador: en un
 * equipo en inglés es mes/día/año y "25" termina siendo "02/05". El texto de
 * abajo ("domingo, 25 de octubre de 2026") muestra siempre qué fecha quedó.
 *
 * Sirve controlado (`value` + `onValueChange`) o dentro de un formulario
 * (`name` + `defaultValue`).
 */
export function DateField({
  value,
  defaultValue,
  onValueChange,
  className,
  hintClassName,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  hintClassName?: string
}) {
  const [inner, setInner] = React.useState(defaultValue ?? "")
  const current = value ?? inner
  const words = formatDayLong(current)

  return (
    <div className="grid gap-1">
      <Input
        {...props}
        type="date"
        className={className}
        {...(value !== undefined ? { value } : { defaultValue })}
        onChange={(event) => {
          setInner(event.target.value)
          onValueChange?.(event.target.value)
        }}
      />
      <p aria-live="polite" className={cn("min-h-4 text-xs text-muted-foreground first-letter:uppercase", hintClassName)}>
        {words}
      </p>
    </div>
  )
}
