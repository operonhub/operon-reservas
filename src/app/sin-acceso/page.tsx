import { logout } from "@/app/login/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function SinAccesoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sin organización asignada</CardTitle>
          <CardDescription>
            Tu usuario no pertenece a ningún alojamiento todavía. Pedile al
            administrador que te agregue.
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
