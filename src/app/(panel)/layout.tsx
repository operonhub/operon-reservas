import { requireContext } from "@/lib/auth"
import { AppSidebar } from "@/components/app-sidebar"

export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requireContext()

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        userName={ctx.fullName}
        orgName={ctx.organizationName}
        role={ctx.role}
      />
      <main className="flex-1 overflow-x-hidden bg-muted/20">{children}</main>
    </div>
  )
}
