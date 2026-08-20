"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  CalendarDays,
  BookMarked,
  BedDouble,
  Tag,
  Settings,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { OperonMark } from "@/components/brand/operon-mark"
import { ThemeToggle } from "@/components/theme-toggle"
import { logout } from "@/app/login/actions"

const NAV = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/calendario", label: "Calendario", icon: CalendarDays },
  { href: "/reservas", label: "Reservas", icon: BookMarked },
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
  // Debajo de `lg` el nav vive en el drawer (ver app-shell-mobile).
  // `print:hidden`: el comprobante de reserva se imprime solo, sin el chrome
  // de la aplicación alrededor.
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex print:hidden">
      <SidebarNav userName={userName} orgName={orgName} role={role} />
    </aside>
  )
}

/**
 * Contenido del sidebar, compartido por el `<aside>` de escritorio y el
 * drawer mobile. `onNavigate` deja cerrar el drawer al tocar un link.
 */
export function SidebarNav({
  userName,
  orgName,
  role,
  onNavigate,
}: {
  userName: string
  orgName: string
  role: string
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  return (
    <>
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <OperonMark className="h-7 w-5 shrink-0" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-heading text-sm font-semibold tracking-tight">
            {orgName}
          </span>
          <span className="label-mono text-muted-foreground">Operon Reservas</span>
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
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition-transform",
                  !active && "group-hover:scale-110"
                )}
              />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 flex items-start justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="label-mono text-muted-foreground">{role}</p>
          </div>
          <ThemeToggle />
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
    </>
  )
}
