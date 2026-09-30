import { cn } from "@/lib/utils"

/** Estado de Mercado Pago del cliente: conexión, nunca montos. */
export function MpBadge({ connected, live }: { connected: boolean; live: boolean }) {
  if (!connected) {
    return (
      <span className="label-mono rounded-md bg-muted px-2 py-1 whitespace-nowrap text-muted-foreground">
        MP sin conectar
      </span>
    )
  }
  return (
    <span
      className={cn(
        "label-mono rounded-md px-2 py-1 whitespace-nowrap",
        live ? "bg-success/15 text-success" : "bg-warning/30 text-warning-foreground"
      )}
    >
      {live ? "MP conectado" : "MP modo prueba"}
    </span>
  )
}
