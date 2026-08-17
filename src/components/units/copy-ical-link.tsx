"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CalendarSync } from "lucide-react"

/**
 * Copia el link del feed iCal de la unidad (fechas ocupadas), para pegarlo
 * en la sincronización de calendarios de Booking/Airbnb.
 */
export function CopyIcalLink({ unitId }: { unitId: string }) {
  function onClick() {
    const url = `${window.location.origin}/ical/${unitId}`
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link de calendario copiado."))
      .catch(() => toast.error("No se pudo copiar el link."))
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground"
      title="Copiar link iCal para Booking/Airbnb"
    >
      <CalendarSync /> iCal
    </Button>
  )
}
