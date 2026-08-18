import { User, Users, UsersRound, Tent, type LucideIcon } from "lucide-react"

/**
 * Perfil de viaje de un huésped, derivado de con cuánta gente suele venir.
 * No hay una columna "tipo de huésped": se infiere de sus reservas, así que
 * el dato se mantiene solo y nadie tiene que cargarlo a mano.
 */
export type GuestKind = "individual" | "pareja" | "familia" | "grupo"

export const GUEST_KIND: Record<
  GuestKind,
  { label: string; icon: LucideIcon; className: string }
> = {
  individual: {
    label: "Individual",
    icon: User,
    className: "bg-muted text-muted-foreground",
  },
  pareja: {
    label: "Pareja",
    icon: Users,
    className: "bg-accent text-accent-foreground",
  },
  familia: {
    label: "Familia",
    icon: UsersRound,
    className: "bg-success/20 text-foreground",
  },
  grupo: {
    label: "Grupo",
    icon: Tent,
    className: "bg-warning/30 text-foreground",
  },
}

export function kindFromCount(count: number): GuestKind {
  if (count <= 1) return "individual"
  if (count === 2) return "pareja"
  if (count <= 4) return "familia"
  return "grupo"
}

/**
 * Tamaño de grupo representativo: el valor MÁS FRECUENTE entre sus reservas,
 * no el máximo — que una vez hayan venido con invitados no convierte a una
 * pareja en un grupo. Ante empate gana el mayor.
 */
export function typicalPartySize(counts: number[]): number {
  if (counts.length === 0) return 1
  const freq = new Map<number, number>()
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1)
  let best = counts[0]
  let bestFreq = 0
  for (const [size, n] of freq) {
    if (n > bestFreq || (n === bestFreq && size > best)) {
      best = size
      bestFreq = n
    }
  }
  return best
}
