import { cn } from "@/lib/utils"
import { ENTER_UP, stagger } from "@/lib/motion"

/**
 * Sección de configuración en dos columnas: a la izquierda qué es y para qué
 * sirve, a la derecha los campos.
 *
 * El texto explicativo al costado evita tener que apretar cada campo para
 * entender qué hace, y aprovecha el ancho que un formulario de una sola
 * columna desperdicia en pantallas grandes.
 */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  index = 0,
  className,
}: {
  icon: React.ElementType
  title: string
  description: string
  children: React.ReactNode
  index?: number
  className?: string
}) {
  return (
    <section
      className={cn(ENTER_UP, "grid gap-5 lg:grid-cols-[260px_1fr]", className)}
      style={stagger(index)}
    >
      <div className="lg:pt-1">
        <h2 className="flex items-center gap-2.5 font-heading text-base font-semibold tracking-tight">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          {title}
        </h2>
        <p className="mt-2 text-sm text-pretty text-muted-foreground lg:ml-[42px]">
          {description}
        </p>
      </div>

      <div className="rounded-2xl border bg-card p-5">{children}</div>
    </section>
  )
}

/** Campo con ícono adentro del input, como en el resto del panel. */
export function IconField({
  icon: Icon,
  children,
}: {
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
      {children}
    </div>
  )
}
