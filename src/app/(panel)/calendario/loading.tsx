import { Skeleton } from "@/components/ui/skeleton"
import { OperonArc } from "@/components/brand/operon-arc"

/** Mismo alto de fila que `availability-calendar.tsx`: si no coinciden, la
 *  grilla salta de alto al reemplazarse el esqueleto por las reservas. */
const ROW_H = 88

/**
 * Esqueleto del calendario. Calca `availability-calendar.tsx`: alto fijo con
 * el encabezado que no scrollea (`shrink-0`) y la grilla ocupando el resto.
 *
 * Es la vista más pesada del panel — grilla ancha, muchas celdas — así que es
 * donde más se nota tener algo en pantalla mientras llegan los datos.
 */
export default function Loading() {
  return (
    <div className="relative flex flex-col lg:h-full lg:overflow-hidden">
      <OperonArc className="inset-0" size={620} thickness={78} corner="bottom-right" />

      <header className="shrink-0 px-4 pt-5 sm:px-6 sm:pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Skeleton className="h-3.5 w-36 rounded-sm" />
            <h1 className="mt-1 text-2xl leading-tight font-semibold sm:text-[28px]">
              Calendario de reservas
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-6 w-52 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </div>

        {/* Navegación de meses */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>

        {/* KPIs del mes */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="size-8 rounded-lg" />
              </div>
              <Skeleton className="mt-3 h-6 w-20" />
            </div>
          ))}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 p-4 pt-4 sm:p-6 sm:pt-5">
        <div className="overflow-hidden rounded-xl border bg-card">
          {/* Fila de días */}
          <div className="flex border-b">
            <div className="w-[9.5rem] shrink-0 border-r px-4 py-2.5 lg:w-[16.5rem]">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex flex-1 gap-2 overflow-hidden px-3 py-2.5">
              {Array.from({ length: 14 }, (_, i) => (
                <Skeleton key={i} className="h-3 w-8 shrink-0" />
              ))}
            </div>
          </div>

          {/* Filas de unidades */}
          {Array.from({ length: 3 }, (_, row) => (
            <div key={row} className="flex border-b last:border-b-0" style={{ height: ROW_H }}>
              <div className="flex w-[9.5rem] shrink-0 items-center gap-2.5 border-r px-4 lg:w-[16.5rem] lg:gap-3 lg:px-5">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                <Skeleton className="h-3.5 w-20" />
              </div>
              <div className="flex flex-1 items-center gap-2 overflow-hidden px-3">
                {/* Barras de distinto largo: una grilla toda pareja se lee como
                    error de carga, no como reservas todavía sin llegar. */}
                <Skeleton
                  className="h-7 shrink-0 rounded-md"
                  style={{ width: `${[28, 15, 22, 18][row]}%` }}
                />
                <Skeleton
                  className="h-7 shrink-0 rounded-md"
                  style={{ width: `${[18, 30, 12, 25][row]}%` }}
                />
                <Skeleton
                  className="h-7 shrink-0 rounded-md"
                  style={{ width: `${[12, 20, 26, 14][row]}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
