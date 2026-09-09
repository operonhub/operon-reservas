import { Skeleton } from "@/components/ui/skeleton"
import { PanelShell, PanelHeaderSkeleton } from "@/components/panel/panel-skeleton"

export default function Loading() {
  return (
    <PanelShell className="space-y-6">
      <PanelHeaderSkeleton
        title="Unidades"
        description={
          <span className="flex items-center gap-1.5">
            {/* Solo la cantidad depende de la base; el resto de la bajada es fija. */}
            <Skeleton className="inline-block h-3.5 w-16 align-middle" />
            <span>· cabañas, lofts y habitaciones reservables</span>
          </span>
        }
        action
      />

      {/* Calca `unit-card.tsx`: foto 4/3, barra de servicios (min-h-[52px]),
          dos stats y la fila de acciones. Si el alto no coincide, las cards
          reales empujan la grilla al reemplazar al esqueleto. */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border bg-card">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="flex min-h-[52px] items-center gap-1.5 border-b px-4 py-3">
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="grid grid-cols-2 gap-4 border-b px-4 py-3.5">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  )
}
