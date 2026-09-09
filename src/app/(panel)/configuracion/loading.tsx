import { Skeleton } from "@/components/ui/skeleton"
import { PanelShell, PanelHeaderSkeleton } from "@/components/panel/panel-skeleton"

export default function Loading() {
  return (
    <PanelShell className="pb-12">
      <PanelHeaderSkeleton
        className="mb-8 max-w-2xl"
        title="Configuración"
        description="Datos de la propiedad, canales de contacto y reglas de operación. Se aplican a todas las unidades del alojamiento."
      />

      <div className="max-w-5xl space-y-8">
        {Array.from({ length: 3 }, (_, i) => (
          <section key={i} className="rounded-2xl border bg-card p-6">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PanelShell>
  )
}
