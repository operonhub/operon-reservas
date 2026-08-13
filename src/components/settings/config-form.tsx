"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { updateProperty } from "@/app/(panel)/configuracion/actions"

type Property = {
  id: string
  name: string
  description: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  city: string | null
  currency: string
  checkin_time: string
  checkout_time: string
  deposit_pct: number
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}

export function ConfigForm({ property }: { property: Property }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  async function handle(formData: FormData) {
    setPending(true)
    const res = await updateProperty(formData)
    setPending(false)
    if (res.ok) {
      toast.success("Configuración guardada.")
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo guardar.")
    }
  }

  return (
    <form action={handle} className="space-y-6">
      <input type="hidden" name="id" value={property.id} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Datos del alojamiento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" required defaultValue={property.name} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={property.description ?? ""}
            />
          </div>
          <Row>
            <div className="grid gap-1.5">
              <Label htmlFor="city">Ciudad</Label>
              <Input id="city" name="city" defaultValue={property.city ?? ""} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="address">Dirección</Label>
              <Input id="address" name="address" defaultValue={property.address ?? ""} />
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contacto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row>
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Teléfono</Label>
              <Input id="phone" name="phone" defaultValue={property.phone ?? ""} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <Input id="whatsapp" name="whatsapp" defaultValue={property.whatsapp ?? ""} />
            </div>
          </Row>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={property.email ?? ""} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Operación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row>
            <div className="grid gap-1.5">
              <Label htmlFor="checkin_time">Check-in</Label>
              <Input id="checkin_time" name="checkin_time" type="time" defaultValue={property.checkin_time.slice(0, 5)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="checkout_time">Check-out</Label>
              <Input id="checkout_time" name="checkout_time" type="time" defaultValue={property.checkout_time.slice(0, 5)} />
            </div>
          </Row>
          <Row>
            <div className="grid gap-1.5">
              <Label htmlFor="currency">Moneda</Label>
              <Input id="currency" name="currency" defaultValue={property.currency} maxLength={3} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deposit_pct">Seña (%)</Label>
              <Input
                id="deposit_pct"
                name="deposit_pct"
                type="number"
                min={0}
                max={100}
                step="1"
                defaultValue={property.deposit_pct}
              />
            </div>
          </Row>
          <p className="text-xs text-muted-foreground">
            El % de seña se usa para calcular el anticipo de cada reserva.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  )
}
