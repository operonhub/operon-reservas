"use client"

import { useActionState } from "react"
import { login } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { OperonWordmark } from "@/components/brand/operon-mark"
import { ENTER, ENTER_UP, stagger } from "@/lib/motion"

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      {/* Único momento de halo effect del panel: el wordmark manda. */}
      <div className={ENTER} style={stagger(0)}>
        <OperonWordmark className="h-11 w-auto" />
      </div>
      <p
        className={`${ENTER} label-mono mt-3 text-muted-foreground`}
        style={stagger(1)}
      >
        Reservas
      </p>

      <Card
        className={`${ENTER_UP} mt-8 w-full max-w-sm`}
        style={stagger(2)}
      >
        <CardContent className="pt-6">
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="admin@demo-cabins.dev"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {state?.error && (
              <p className="animate-in fade-in text-sm text-destructive motion-reduce:animate-none">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Ingresando…" : "Ingresar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p
        className={`${ENTER} mt-6 text-xs text-muted-foreground`}
        style={stagger(3)}
      >
        Panel de administración del alojamiento
      </p>
    </main>
  )
}
