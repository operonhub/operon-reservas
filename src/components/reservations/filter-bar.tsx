import Link from "next/link"
import { cn } from "@/lib/utils"

export const RESERVATION_FILTERS = [
  { key: "proximas", label: "Próximas" },
  { key: "pendientes", label: "Pendientes" },
  { key: "confirmadas", label: "Confirmadas" },
  { key: "canceladas", label: "Canceladas" },
  { key: "expiradas", label: "Expiradas" },
  { key: "finalizadas", label: "Finalizadas" },
  { key: "todas", label: "Todas" },
] as const

export function FilterBar({ active }: { active: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RESERVATION_FILTERS.map((f) => (
        <Link
          key={f.key}
          href={`/reservas?f=${f.key}`}
          className={cn(
            "rounded-full px-3 py-1 text-sm transition-all",
            active === f.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          )}
        >
          {f.label}
        </Link>
      ))}
    </div>
  )
}
