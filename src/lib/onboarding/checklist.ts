/**
 * Lista "Primeros pasos" de Inicio. Cada ítem se tilda con datos reales, no
 * con clics en la lista: si el dueño configura la seña desde Configuración,
 * aparece hecha igual. Sin imports de servidor.
 */

export type ChecklistInput = {
  units: number
  unitsWithBaseRate: number
  depositPct: number
  mpConnected: boolean
  linkShared: boolean
  reservations: number
}

export type ChecklistItem = {
  key: "unidades" | "precio" | "sena" | "mercadopago" | "link" | "reserva"
  title: string
  description: string
  done: boolean
  href?: string
  cta?: string
}

export type Checklist = {
  items: ChecklistItem[]
  done: number
  total: number
  allDone: boolean
}

export function deriveChecklist(input: ChecklistInput): Checklist {
  const items: ChecklistItem[] = [
    {
      key: "unidades",
      title: "Cargar tu complejo y tus unidades",
      description: "Nombre, capacidad y fotos de cada unidad.",
      done: input.units > 0,
      href: "/unidades",
      cta: "Ir a Unidades",
    },
    {
      key: "precio",
      title: "Poner un precio base a cada unidad",
      description: "Sin precio, las reservas quedan sin total.",
      done: input.units > 0 && input.unitsWithBaseRate >= input.units,
      href: "/tarifas",
      cta: "Ir a Tarifas",
    },
    {
      key: "sena",
      title: "Definir la seña",
      description: "El porcentaje que se paga para confirmar una reserva.",
      done: input.depositPct > 0,
      href: "/configuracion",
      cta: "Configurar",
    },
    {
      key: "mercadopago",
      title: "Conectar Mercado Pago",
      description: "Para cobrar la seña online, sin esperar transferencias.",
      done: input.mpConnected,
      href: "/configuracion",
      cta: "Conectar",
    },
    {
      key: "link",
      title: "Compartir tu link de reservas",
      description: "Copialo y mandalo por WhatsApp o ponelo en tu Instagram.",
      done: input.linkShared,
    },
    {
      key: "reserva",
      title: "Cargar tu primera reserva",
      description: "Aunque haya llegado por teléfono o WhatsApp.",
      done: input.reservations > 0,
      href: "/reservas",
      cta: "Ir a Reservas",
    },
  ]
  const done = items.filter((item) => item.done).length
  return { items, done, total: items.length, allDone: done === items.length }
}
