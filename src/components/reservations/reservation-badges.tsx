import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  RESERVATION_STATUS_LABELS,
  RESERVATION_SOURCE_LABELS,
} from "@/lib/constants"
import type { Enums } from "@/lib/supabase/types"

// Semántica de color sobre la paleta de marca:
//   confirmed/completed → OK (success)   · el estado "bueno"
//   pending_payment     → Sol (warning)  · esperando plata, acento cálido
//   cancelled/expired   → apagados       · ya no ocupan inventario
// El Azul (primary) NO se usa acá: está reservado para acciones/CTAs, y si lo
// gastáramos en un badge dejaría de leerse como "esto es clickeable".
// Regla del sistema: el FONDO lleva la señal semántica (Sol = esperando plata,
// OK = confirmada, rose = cancelada) y el TEXTO usa siempre un token legible.
//
// El motivo es concreto: los acentos de marca no sirven como color de texto en
// los dos temas. El Sol es muy claro (solo contrasta sobre Tinta) y el verde OK
// sobre Papel da 3.5:1, por debajo de AA. Tiñendo el fondo y dejando el texto
// en foreground/muted, los siete estados pasan 4.5:1 en claro Y en oscuro,
// sin perder la lectura de color de un vistazo.
const STATUS_CLASS: Record<Enums<"reservation_status">, string> = {
  inquiry: "bg-muted text-muted-foreground",
  pending: "bg-secondary text-secondary-foreground",
  pending_payment: "bg-warning/30 text-foreground",
  confirmed: "bg-success/25 text-foreground",
  completed: "bg-success/10 text-muted-foreground",
  cancelled: "bg-destructive/15 text-foreground line-through",
  expired: "bg-muted text-muted-foreground line-through",
}

export function StatusBadge({ status }: { status: Enums<"reservation_status"> }) {
  return (
    <Badge
      className={cn(
        "label-mono border-transparent font-medium",
        STATUS_CLASS[status]
      )}
    >
      {RESERVATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: Enums<"reservation_source"> }) {
  return (
    <Badge variant="outline" className="label-mono text-muted-foreground">
      {RESERVATION_SOURCE_LABELS[source]}
    </Badge>
  )
}
