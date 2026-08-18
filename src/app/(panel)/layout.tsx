import { requireContext } from "@/lib/auth"
import { AppSidebar } from "@/components/app-sidebar"

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
      <main className="relative flex-1 overflow-y-auto overflow-x-hidden bg-muted/20">
        {children}
      </main>
    </div>
  )
}
