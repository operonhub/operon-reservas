"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const ITEMS = [
  { href: "/operon", label: "Clientes" },
  { href: "/operon/invitaciones", label: "Invitaciones" },
  { href: "/operon/actividad", label: "Actividad" },
]

/** Clientes también queda marcado dentro de la ficha de un cliente. */
function isActive(pathname: string, href: string) {
  if (href === "/operon") return pathname === "/operon" || pathname.startsWith("/operon/clientes")
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function OperonNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Secciones" className="flex items-center gap-1">
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
