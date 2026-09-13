"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CalendarSync } from "lucide-react"

/**
 * Copia el link del feed iCal de la unidad (fechas ocupadas), para pegarlo
 * en la sincronización de calendarios de Booking/Airbnb. El token va en el
 * link: sin él, el feed responde 404 (migración 0028).
 */
export function CopyIcalLink({ unitId, token }: { unitId: string; token: string }) {
  function onClick() {
    const url = `${window.location.origin}/ical/${unitId}?t=${encodeURIComponent(token)}`
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
