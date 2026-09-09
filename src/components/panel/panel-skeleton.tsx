import { Skeleton } from "@/components/ui/skeleton"
import { OperonArc } from "@/components/brand/operon-arc"
import { cn } from "@/lib/utils"

/**
 * Piezas del esqueleto de carga del panel.
 *
 * Por qué existen: las seis vistas del panel leen cookies, así que para Next
 * son rutas dinámicas. Sin un `loading.tsx`, Next descarta el prefetch por
 * completo y el click en la sidebar espera el HTML entero sin pintar nada.
 * Con `loading.tsx`, ese archivo es lo ÚNICO que el navegador puede tener
 * listo antes del click — aparece a los 0 ms.
 *
 * De ahí el criterio: el esqueleto no es un spinner. Todo lo que ya se sabe
 * sin consultar la base (el título de la vista, su bajada, el arco de marca)
 * se dibuja de verdad, y solo se agrisa lo que depende de datos. El usuario
 * ve la pantalla correcta al instante y solo espera los números.
 *
 * Regla al tocar estos componentes: tienen que calcar la estructura del
 * `page.tsx` que acompañan (mismo padding, mismo `space-y`, mismos altos).
 * Si no calzan, el contenido real "salta" al reemplazar al esqueleto y se
 * siente peor que no haber puesto nada.
 */

export function PanelShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("relative p-4 sm:p-6", className)}>
      <OperonArc className="inset-0" size={560} thickness={70} corner="bottom-right" />
      {children}
    </div>
  )
}

/**
 * Encabezado de vista. `title` y `description` son texto real, no esqueleto:
 * no dependen de la base. Solo se agrisa el nombre de la organización (viene
 * de `requireContext`) y el botón de acción (depende de si hay unidades).
 */
export function PanelHeaderSkeleton({
  title,
  description,
  action = false,
  className,
}: {
  title: string
  description?: React.ReactNode
  action?: boolean
  className?: string
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        {/* Calca el alto de `.label-mono` (10px + tracking) para que el <h1> no se mueva. */}
        <Skeleton className="h-3.5 w-36 rounded-sm" />
        <h1 className="mt-1 text-2xl leading-tight font-semibold sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-xl text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <Skeleton className="h-9 w-36 rounded-md" />}
    </header>
  )
}

/** Grilla de cards. `rows` es cuántas dibujar antes de que llegue la data. */
export function CardsSkeleton({
  count = 4,
  className,
  cardClassName,
}: {
  count?: number
  className?: string
  cardClassName?: string
}) {
  return (
    <div className={cn("grid gap-5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn(
            "rounded-xl border bg-card p-5 shadow-sm",
            cardClassName
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
          <Skeleton className="mt-4 h-7 w-24" />
          <Skeleton className="mt-4 h-3 w-40" />
        </div>
      ))}
    </div>
  )
}

/** Lista de filas dentro de una card (reservas, agenda, llegadas). */
export function RowsSkeleton({
  count = 6,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40 max-w-[60%]" />
            <Skeleton className="h-3 w-28 max-w-[40%]" />
          </div>
          <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  )
}
