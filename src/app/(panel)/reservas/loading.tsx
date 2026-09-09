import { Skeleton } from "@/components/ui/skeleton"
import {
  PanelShell,
  PanelHeaderSkeleton,
  RowsSkeleton,
} from "@/components/panel/panel-skeleton"

/** Las 7 píldoras del filtro van como esqueleto y no como links reales:
 *  `loading.tsx` no recibe searchParams, así que marcar una activa sería
 *  adivinar, y el parpadeo de la píldora equivocada se nota más que el gris. */
const FILTER_WIDTHS = ["w-20", "w-24", "w-26", "w-24", "w-20", "w-24", "w-16"]

export default function Loading() {
  return (
    <PanelShell className="space-y-5">
      <PanelHeaderSkeleton title="Reservas" action />

      <div className="flex flex-wrap gap-1.5">
        {FILTER_WIDTHS.map((w, i) => (
          <Skeleton key={i} className={`h-7 rounded-full ${w}`} />
        ))}
      </div>

      <RowsSkeleton count={8} />
    </PanelShell>
  )
}
