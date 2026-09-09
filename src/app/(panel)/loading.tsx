import { Skeleton } from "@/components/ui/skeleton"
import { OperonArc } from "@/components/brand/operon-arc"
import { OperonMarkPapel, OperonMarkTinta } from "@/components/brand/operon-mark"
import { CardsSkeleton, RowsSkeleton } from "@/components/panel/panel-skeleton"

/** Esqueleto de Inicio. Calca `(panel)/page.tsx`: héroe oscuro, franja de
 *  métricas montada sobre él (`-mt-14`) y las dos cards de abajo. */
export default function Loading() {
  return (
    <div className="relative min-h-full overflow-hidden p-4 sm:p-6 lg:p-8">
      <OperonArc className="inset-0" size={660} thickness={78} corner="bottom-right" />

      <div className="relative mx-auto max-w-7xl">
        <div className="relative">
          <header className="relative min-h-[280px] overflow-hidden rounded-[1.75rem] bg-foreground px-5 pt-6 pb-20 text-background shadow-xl shadow-foreground/10 sm:px-8 sm:pt-8 sm:pb-24 lg:px-10">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 82% 12%, color-mix(in oklch, var(--warning) 26%, transparent), transparent 34%)",
              }}
            />
            <div
              aria-hidden
              className="absolute -top-36 -right-24 size-96 rounded-full border border-background/10"
            />

            <div className="relative z-10 max-w-2xl pr-0 md:pr-48">
              {/* Sobre el fondo oscuro el `bg-muted` del Skeleton no se ve: acá
                  el marcador de posición va en blanco translúcido. */}
              <Skeleton className="h-3.5 w-56 rounded-sm bg-background/15" />
              <Skeleton className="mt-5 h-12 w-80 max-w-full rounded-lg bg-background/15 sm:h-16" />
              <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-1">
                <p className="text-base font-medium text-background/90 sm:text-lg">
                  Esto es lo importante de hoy.
                </p>
                <Skeleton className="h-3.5 w-44 rounded-sm bg-background/15" />
              </div>
              <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Skeleton className="h-9 w-40 rounded-md bg-background/15" />
                <Skeleton className="h-9 w-36 rounded-md bg-background/15" />
              </div>
            </div>

            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 -right-8 -translate-y-1/2 opacity-[0.12] md:right-10 md:opacity-100"
            >
              <OperonMarkPapel className="h-64 w-44 drop-shadow-2xl dark:hidden" />
              <OperonMarkTinta className="hidden h-64 w-44 drop-shadow-2xl dark:block" />
            </div>
          </header>

          <CardsSkeleton
            count={4}
            className="relative z-20 -mt-14 gap-3 px-3 sm:grid-cols-2 sm:px-5 xl:grid-cols-4 xl:px-8"
            cardClassName="min-h-36 border-0 py-4 shadow-lg shadow-foreground/[0.06] ring-1 ring-foreground/10"
          />
        </div>

        <section className="mt-6 grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <RowsSkeleton count={4} />
          </div>
          <div className="lg:col-span-5">
            <RowsSkeleton count={3} />
          </div>
        </section>
      </div>
    </div>
  )
}
