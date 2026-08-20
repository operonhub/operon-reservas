import { requireContext } from "@/lib/auth"
import { AppSidebar } from "@/components/app-sidebar"
import { AppShellMobile } from "@/components/app-shell-mobile"

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requireContext()

  return (
    // Alto fijo con scroll en el <main>: así una vista puede ocupar la
    // pantalla completa y scrollear por dentro (el calendario lo necesita
    // para dejar el encabezado fijo), sin romper las páginas que
    // simplemente crecen hacia abajo.
    <div className="flex h-screen overflow-hidden">
      <AppSidebar
        userName={ctx.fullName}
        orgName={ctx.organizationName}
        role={ctx.role}
      />
      {/* `min-w-0`: sin esto el grid ancho del calendario estira la columna y
          reaparece el scroll horizontal de toda la página. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppShellMobile
          userName={ctx.fullName}
          orgName={ctx.organizationName}
          role={ctx.role}
        />
        {/* `min-h-0`: acá el alto lo da `flex-1`, y el `min-height: auto` que
            traen los flex items impediría achicarse -> <main> crecería con el
            contenido y el `overflow-y-auto` nunca scrollearía. */}
        <main className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-muted/20">
          {children}
        </main>
      </div>
    </div>
  )
}
