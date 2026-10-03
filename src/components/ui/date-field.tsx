"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { dateOrder, dateOrderHint, formatDayLong, type DateOrder } from "@/lib/format"
import { cn } from "@/lib/utils"

// El orden del equipo solo se conoce en el navegador. En el servidor se asume
// día/mes/año (sin aviso), así la primera pintura coincide y no parpadea.
const subscribe = () => () => {}
const browserOrder = (): DateOrder => dateOrder()
const serverOrder = (): DateOrder => "dmy"

/**
 * Campo de fecha con la fecha elegida escrita en palabras debajo.
 *
 * El control nativo ordena día y mes según el idioma del navegador: en un
 * equipo en inglés es mes/día/año y "25" termina siendo "02/05". El texto de
 * abajo ("domingo, 25 de octubre de 2026") muestra siempre qué fecha quedó, y a
 * quien tiene otro orden se le avisa cuál es el suyo. Con día/mes/año no se ve
 * nada extra.
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
  orderNotice = true,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  hintClassName?: string
  /** El aviso de orden va una vez por formulario: apagarlo en el segundo campo. */
  orderNotice?: boolean
}) {
  const [inner, setInner] = React.useState(defaultValue ?? "")
  const current = value ?? inner
  const words = formatDayLong(current)
  const orderHint = dateOrderHint(React.useSyncExternalStore(subscribe, browserOrder, serverOrder))

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
      {orderNotice && orderHint && (
        <p className="rounded-md bg-warning/20 px-2 py-1 text-xs text-foreground">
          {orderHint} Tocá el ícono del calendario para elegir el día.
        </p>
      )}
    </div>
  )
}
