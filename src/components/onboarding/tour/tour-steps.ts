export type TourStep = {
  id: string
  label: string
  title: string
  body: string
  /** Valor de `data-tour` del elemento a señalar; null = tarjeta centrada. */
  anchor: string | null
  /** Si el ancla no está visible (nav en mobile), se señala esta otra. */
  mobileAnchor?: string
  /** Si el ancla no existe (lista ya ocultada), el paso se saltea. */
  optional?: boolean
}

/** El paso 0 solo se muestra al llegar recién creado desde el asistente. */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "bienvenida",
    label: "Bienvenida",
    title: "¡Tu complejo está listo!",
    body: "En un minuto te mostramos dónde está cada cosa.",
    anchor: null,
  },
  {
    id: "inicio",
    label: "Inicio",
    title: "Tu día de un vistazo",
    body: "Ocupación, reservas pendientes, llegadas de hoy y lo cobrado en el mes.",
    anchor: "metricas",
  },
  {
    id: "calendario",
    label: "Calendario",
    title: "Tu ocupación, día por día",
    body: "Cada unidad en una fila. Tocá una estadía para ver el detalle, o bloqueá las fechas que no alquilás.",
    anchor: "nav-calendario",
    mobileAnchor: "menu",
  },
  {
    id: "reservas",
    label: "Reservas",
    title: "Todas tus reservas",
    body: "Con su estado de pago y los datos del huésped. Desde acá cargás las que te llegan por teléfono o WhatsApp.",
    anchor: "nav-reservas",
    mobileAnchor: "menu",
  },
  {
    id: "tarifas",
    label: "Tarifas",
    title: "Tus precios",
    body: "El precio base ya está. Sumá temporadas, fines de semana o estadías mínimas cuando quieras.",
    anchor: "nav-tarifas",
    mobileAnchor: "menu",
  },
  {
    id: "link",
    label: "Tu link",
    title: "Tu link de reservas",
    body: "Compartilo por WhatsApp o Instagram para que te reserven directo.",
    anchor: "link",
    mobileAnchor: "menu",
  },
  {
    id: "primeros-pasos",
    label: "Primeros pasos",
    title: "Lo que te falta",
    body: "Seguí esta lista para dejar todo andando: la seña, Mercado Pago y tu primera reserva.",
    anchor: "primeros-pasos",
    optional: true,
  },
  {
    id: "ayuda",
    label: "Ayuda",
    title: "¿Lo querés ver de nuevo?",
    body: "Este recorrido queda siempre en «Ver tutorial».",
    anchor: "tutorial",
    mobileAnchor: "menu",
  },
]
