import { ArrowLeft } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

/** Detalle de reserva. El "Volver a Reservas" se dibuja de verdad: es la
 *  salida más usada de esta pantalla y no depende de ningún dato. */
export default function Loading() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Volver a Reservas
        </span>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>

      <article className="mx-auto max-w-3xl rounded-2xl border bg-card p-8">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
          <div>
            <Skeleton className="h-7 w-56" />
            <div className="mt-2 space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </header>

        <div className="mt-6 space-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </article>
    </div>
  )
}
