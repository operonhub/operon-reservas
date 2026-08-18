import { cn } from "@/lib/utils"

/**
 * Cuarto de anillo en Sol — firma visual de Operon.
 *
 * Es decoración de fondo: `pointer-events-none` para no robar clicks y
 * `aria-hidden` para que no aparezca en lectores de pantalla. Se dibuja con
 * un borde grueso sobre un cuadrado gigante, así el arco mantiene su grosor
 * en cualquier tamaño (a diferencia de un SVG escalado, donde el trazo se
 * deforma).
 */
export function OperonArc({
  className,
  size = 520,
  thickness = 64,
  corner = "bottom-right",
}: {
  className?: string
  size?: number
  thickness?: number
  /** Esquina donde "nace" el arco. */
  corner?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
}) {
  // El anillo se corre media vuelta hacia afuera y el contenedor lo recorta:
  // queda visible sólo el cuadrante que mira hacia adentro de la pantalla.
  // El desplazamiento va en píxeles y no en %, porque un % se calcula contra
  // el contenedor (toda la vista) y no contra el círculo — que es lo que
  // define dónde cae el cuarto de arco.
  const half = size / 2
  const place =
    corner === "bottom-right"
      ? { right: -half, bottom: -half }
      : corner === "bottom-left"
        ? { left: -half, bottom: -half }
        : corner === "top-right"
          ? { right: -half, top: -half }
          : { left: -half, top: -half }

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute overflow-hidden select-none",
        className
      )}
    >
      <div
        className="absolute rounded-full border-warning/35"
        style={{ width: size, height: size, borderWidth: thickness, ...place }}
      />
    </div>
  )
}
