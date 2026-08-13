"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  CalendarDays,
  BookMarked,
  Users,
  BedDouble,
  Tag,
  Settings,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { logout } from "@/app/login/actions"

const NAV = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/calendario", label: "Calendario", icon: CalendarDays },
  { href: "/reservas", label: "Reservas", icon: BookMarked },
  { href: "/huespedes", label: "Huéspedes", icon: Users },
  { href: "/unidades", label: "Unidades", icon: BedDouble },
  { href: "/tarifas", label: "Tarifas", icon: Tag },
  { href: "/configuracion", label: "Configuración", icon: Settings },
]

export function AppSidebar({
  userName,
  orgName,
  role,
}: {
  userName: string
  orgName: string
  role: string
}) {
  const pathname = usePathname()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
          O
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">{orgName}</span>
          <span className="text-[11px] text-muted-foreground">Operon Reservas</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 px-1">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="text-xs text-muted-foreground capitalize">{role}</p>
        </div>
        <form action={logout}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Salir
          </Button>
        </form>
      </div>
    </aside>
  )
}
