import { redirect } from "next/navigation"
import { logout } from "@/app/login/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Cuenta suspendida", robots: { index: false } }

/**
 * Adónde manda requireContext a los miembros de un complejo suspendido desde
 * el panel de Operon. Vive fuera de (panel) para no volver a pasar por
 * requireContext. El motivo no se muestra: es interno de Operon.
 */
export default async function SuspendidaPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims?.sub) redirect("/login")

  const { data: membership } = await supabase
    .from("memberships")
    .select("organizations(name, suspended_at)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  type Org = { name: string; suspended_at: string | null }
  const org = membership?.organizations as Org | Org[] | null
  const orgObj = Array.isArray(org) ? org[0] : org
  // Ya lo reactivaron (o nunca estuvo suspendido): de vuelta al panel.
  if (!orgObj?.suspended_at) redirect("/")

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Tu cuenta está suspendida</CardTitle>
          <CardDescription>
            El panel de {orgObj.name} no está disponible por ahora y tu página
            de reservas no recibe reservas nuevas. Las reservas y los pagos que
            ya estaban en curso siguen funcionando. Escribinos para reactivarla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={logout}>
            <Button type="submit" variant="outline" className="w-full">
              Salir
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
