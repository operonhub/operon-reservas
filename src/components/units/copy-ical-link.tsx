"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CalendarSync } from "lucide-react"

export type IcalCanal = "booking" | "airbnb"

const CANAL_LABEL: Record<IcalCanal, string> = { booking: "Booking", airbnb: "Airbnb" }

/**
 * Copia el link del feed iCal de la unidad (fechas ocupadas), para pegarlo
 * en la sincronización de calendarios de Booking/Airbnb. El token va en el
 * link: sin él, el feed responde 404 (migración 0028).
 *
 * Cada plataforma tiene SU link (`canal`): así nunca le devolvemos las fechas
 * que importamos de ella misma, que es lo que hacía desaparecer sus reservas
 * de su propio calendario (0042).
 */
export function CopyIcalLink({ unitId, token, canal }: { unitId: string; token: string; canal: IcalCanal }) {
  function onClick() {
    const url = `${window.location.origin}/ical/${unitId}?t=${encodeURIComponent(token)}&canal=${canal}`
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(`Link para ${CANAL_LABEL[canal]} copiado. Pegalo solo en ${CANAL_LABEL[canal]}.`))
      .catch(() => toast.error("No se pudo copiar el link."))
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground"
      title={`Copiar el link de calendario para pegar en ${CANAL_LABEL[canal]}`}
    >
      <CalendarSync /> Copiar para {CANAL_LABEL[canal]}
    </Button>
  )
}
