import { Skeleton } from "@/components/ui/skeleton"
import { PanelShell, PanelHeaderSkeleton } from "@/components/panel/panel-skeleton"

export default function Loading() {
  return (
    <PanelShell className="space-y-6">
      <PanelHeaderSkeleton
        title="Tarifas"
        description="Precio base de cada unidad y reglas que lo modifican por fecha, día o tipo de estadía."
        action
      />

      <div className="grid gap-5 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="rounded-2xl border bg-card p-5">
            <div className="flex items-start justify-between gap-3 border-b pb-4">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-8 w-28 rounded-md" />
            </div>
            <Skeleton className="mt-4 h-8 w-40" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 3 }, (_, j) => (
                <div key={j} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3.5 w-44 max-w-[55%]" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}
