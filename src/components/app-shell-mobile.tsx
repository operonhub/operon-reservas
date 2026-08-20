"use client"

import * as React from "react"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { SidebarNav } from "@/components/app-sidebar"
import { OperonMark } from "@/components/brand/operon-mark"

/**
 * Chrome de la aplicación por debajo de `lg`: barra superior con hamburguesa
 * y el mismo nav del sidebar dentro de un drawer.
 */
export function AppShellMobile({
  userName,
  orgName,
  role,
}: {
  userName: string
  orgName: string
  role: string
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-3 text-sidebar-foreground lg:hidden print:hidden">
        <SheetTrigger
          render={<Button variant="ghost" size="icon" className="text-muted-foreground" />}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Abrir menú</span>
        </SheetTrigger>

        <OperonMark className="h-7 w-5 shrink-0" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-heading text-sm font-semibold tracking-tight">
            {orgName}
          </span>
          <span className="label-mono text-muted-foreground">Operon Reservas</span>
        </div>
      </header>

      {/* Mismo ancho que el sidebar de escritorio, sin la X: se cierra tocando
          el fondo o navegando. */}
      <SheetContent
        side="left"
        showCloseButton={false}
        className="gap-0 bg-sidebar text-sidebar-foreground data-[side=left]:w-60"
      >
        <SheetTitle className="sr-only">Navegación</SheetTitle>
        <SidebarNav
          userName={userName}
          orgName={orgName}
          role={role}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
