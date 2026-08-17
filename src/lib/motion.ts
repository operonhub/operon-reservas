/**
 * Clases de animación de entrada — una sola curva y duración para todo el
 * producto (tw-animate-css, sin JS ni dependencias).
 *
 * Criterio: la animación tiene que ayudar a entender que algo cambió de
 * estado. Nada que bloquee el scroll ni que obligue a esperar. Todas las
 * constantes traen `motion-reduce:animate-none`, así que respetan
 * `prefers-reduced-motion` sin que haya que acordarse en cada uso.
 */

/** Aparición simple (opacidad). Para contenido que ya está en su lugar. */
export const ENTER = "animate-in fade-in duration-500 motion-reduce:animate-none"

/** Entrada desde abajo. El default para secciones, cards y filas. */
export const ENTER_UP =
  "animate-in fade-in slide-in-from-bottom-3 duration-500 motion-reduce:animate-none"

/** Entrada lateral, para los pasos de un wizard que avanza. */
export const ENTER_SIDE =
  "animate-in fade-in slide-in-from-right-4 duration-400 motion-reduce:animate-none"

/** Entrada con zoom corto. Reservado para el hito de confirmación. */
export const ENTER_POP =
  "animate-in fade-in zoom-in-95 duration-500 motion-reduce:animate-none"

/**
 * Retraso escalonado para listas.
 *
 * `animationFillMode: "backwards"` es imprescindible: sin eso el elemento se
 * pinta en su estado final durante el delay y recién ahí anima, con lo cual
 * el escalonado no se percibe. Con "backwards" mantiene el primer keyframe
 * (invisible) hasta que le toca entrar.
 */
export function stagger(index: number, stepMs = 60): React.CSSProperties {
  return {
    animationDelay: `${index * stepMs}ms`,
    animationFillMode: "backwards",
  }
}
