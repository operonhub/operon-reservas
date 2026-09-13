import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { LogOut } from "lucide-react"
import { logout } from "@/app/login/actions"
import { OperonArc } from "@/components/brand/operon-arc"
import { OperonMark } from "@/components/brand/operon-mark"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { OperonNav } from "./operon-nav"

export const metadata: Metadata = {
  title: "Operon · uso interno",
  robots: { index: false, follow: false },
}

/**
 * Panel interno de Operon. A quien no es platform admin le responde 404 en
 * vez de "sin permiso", para no anunciar que existe. Las RPC de cada página
 * vuelven a exigirlo: este chequeo es para no mostrar la pantalla, no es la
 * única puerta.
 */
export default async function OperonLayout({ children }: { children: React.ReactNode }) {
  if ((await cookies()).get("operon_demo")?.value === "1") notFound()

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getClaims()
  if (!auth?.claims?.sub) redirect("/login")

  const { data: isAdmin } = await supabase.rpc("is_platform_admin")
  if (!isAdmin) notFound()

  const email = typeof auth.claims.email === "string" ? auth.claims.email : ""

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <OperonArc className="inset-0" size={520} thickness={64} corner="bottom-right" />

      <header className="relative border-b bg-sidebar/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2.5">
              <OperonMark className="h-7 w-5 shrink-0" />
              <div className="leading-tight">
                <p className="font-heading text-sm font-semibold tracking-tight">Operon</p>
                <p className="label-mono text-muted-foreground">Uso interno</p>
              </div>
            </div>
            <OperonNav />
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground md:inline">{email}</span>
            <ThemeToggle />
            <form action={logout}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut /> Salir
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  )
}
