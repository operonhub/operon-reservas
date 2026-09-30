import { OperonFooter } from "@/components/public/operon-footer"

/**
 * Lo que ve el huésped cuando el complejo está suspendido desde el panel de
 * Operon. Neutral a propósito: no dice por qué ni menciona la suspensión.
 */
export function BookingUnavailable() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Reservas no disponibles
          </h1>
          <p className="mt-3 text-muted-foreground">
            Las reservas online no están disponibles en este momento. Si ya
            tenés una reserva, sigue vigente.
          </p>
        </div>
      </div>
      <OperonFooter />
    </main>
  )
}
