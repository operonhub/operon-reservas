"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SettingsSection, IconField } from "@/components/settings/settings-section"
import { updateProperty } from "@/app/(panel)/configuracion/actions"
import { CURRENCIES } from "@/lib/currencies"
import { LocationPicker, locationPickerAvailable } from "@/components/location/location-picker"
import type { PropertyLocation } from "@/lib/location/types"
import {
  Building2, Phone, MessageCircle, Mail, SlidersHorizontal, Clock,
  Wallet, Info, MapPin,
} from "lucide-react"

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
  lat?: number | null
  lng?: number | null
  place_id?: string | null
  province_id?: string | null
  province_name?: string | null
  department_id?: string | null
  department_name?: string | null
  locality_id?: string | null
}

/** La ubicación guardada (0036), si el dueño ya la marcó en el mapa. */
function savedLocation(p: Property): PropertyLocation | null {
  if (typeof p.lat !== "number" || typeof p.lng !== "number") return null
  return {
    address: p.address ?? "",
    lat: p.lat,
    lng: p.lng,
    placeId: p.place_id ?? null,
    provinceId: p.province_id ?? null,
    provinceName: p.province_name ?? null,
    departmentId: p.department_id ?? null,
    departmentName: p.department_name ?? null,
    localityId: p.locality_id ?? null,
    city: p.city,
  }
}

/** Texto libre de siempre: sin clave de Google, o si Google no carga. */
function CityAddressFields({ property }: { property: Property }) {
  return (
    <Pair>
      <Field htmlFor="city" label="Ciudad">
        <IconField icon={MapPin}>
          <Input id="city" name="city" className="pl-8" defaultValue={property.city ?? ""} />
        </IconField>
      </Field>
      <Field htmlFor="address" label="Dirección">
        <Input id="address" name="address" defaultValue={property.address ?? ""} />
      </Field>
    </Pair>
  )
}

function Pair({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
}

function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="label-mono text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function ConfigForm({
  property,
  readOnly = false,
}: {
  property: Property
  /** Staff ve la configuración pero no la cambia (0025). */
  readOnly?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [location, setLocation] = React.useState<PropertyLocation | null>(() => savedLocation(property))

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
    <form action={handle} className="space-y-8">
      <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-8 border-0 p-0">
        <input type="hidden" name="id" value={property.id} />

        <SettingsSection
          icon={Building2}
          title="Datos del alojamiento"
          description="Información general de la propiedad. El nombre y los horarios aparecen en el comprobante que recibe el huésped."
        >
          <div className="space-y-4">
            <Field htmlFor="name" label="Nombre del establecimiento">
              <Input
                id="name"
                name="name"
                required
                defaultValue={property.name}
                placeholder="Cabañas del Beagle"
              />
            </Field>
            <Field htmlFor="description" label="Descripción">
              <Textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={property.description ?? ""}
                placeholder="Breve descripción del lugar y sus comodidades…"
              />
            </Field>
            {locationPickerAvailable ? (
              <Field htmlFor="location" label="Ubicación">
                {/* Viaja entera; el servidor vuelve a pedir la localidad oficial. */}
                <input type="hidden" name="location" value={location ? JSON.stringify(location) : "null"} />
                <LocationPicker
                  value={location}
                  onChange={setLocation}
                  fallback={<CityAddressFields property={property} />}
                />
                {!location && property.city && (
                  <p className="text-xs text-muted-foreground">
                    Hoy figura como &quot;{property.city}&quot;. Marcala en el mapa para que la app sepa
                    la localidad exacta.
                  </p>
                )}
              </Field>
            ) : (
              <CityAddressFields property={property} />
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Phone}
          title="Contacto"
          description="Canales oficiales para reservas y consultas. El WhatsApp es el que ve el huésped al confirmar su pago."
        >
          <div className="space-y-4">
            <Pair>
              <Field htmlFor="phone" label="Teléfono">
                <IconField icon={Phone}>
                  <Input
                    id="phone"
                    name="phone"
                    className="pl-8"
                    defaultValue={property.phone ?? ""}
                    placeholder="+54 9 351 555 0001"
                  />
                </IconField>
              </Field>
              <Field htmlFor="whatsapp" label="WhatsApp">
                <IconField icon={MessageCircle}>
                  <Input
                    id="whatsapp"
                    name="whatsapp"
                    className="pl-8"
                    defaultValue={property.whatsapp ?? ""}
                    placeholder="+54 9 351 555 0001"
                  />
                </IconField>
              </Field>
            </Pair>
            <Field htmlFor="email" label="Email">
              <IconField icon={Mail}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  className="pl-8"
                  defaultValue={property.email ?? ""}
                  placeholder="hola@tualojamiento.com"
                />
              </IconField>
            </Field>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={SlidersHorizontal}
          title="Operación"
          description="Horarios de entrada y salida, moneda y política de anticipo. Cambiar la seña afecta a las reservas nuevas, no a las ya generadas."
        >
          <div className="space-y-4">
            <Pair>
              <Field htmlFor="checkin_time" label="Horario de check-in">
                <IconField icon={Clock}>
                  <Input
                    id="checkin_time"
                    name="checkin_time"
                    type="time"
                    className="pl-8"
                    defaultValue={property.checkin_time.slice(0, 5)}
                  />
                </IconField>
              </Field>
              <Field htmlFor="checkout_time" label="Horario de check-out">
                <IconField icon={Clock}>
                  <Input
                    id="checkout_time"
                    name="checkout_time"
                    type="time"
                    className="pl-8"
                    defaultValue={property.checkout_time.slice(0, 5)}
                  />
                </IconField>
              </Field>
            </Pair>
            <Pair>
              <Field htmlFor="currency" label="Moneda principal">
                {/* Una sola moneda (pesos): se muestra, no se elige. */}
                <input type="hidden" name="currency" value={CURRENCIES[0].code} />
                <IconField icon={Wallet}>
                  <Input
                    id="currency"
                    readOnly
                    value={`${CURRENCIES[0].label} (${CURRENCIES[0].code})`}
                    className="pl-8 text-muted-foreground"
                  />
                </IconField>
              </Field>
              <Field htmlFor="deposit_pct" label="Porcentaje de seña (%)">
                <Input
                  id="deposit_pct"
                  name="deposit_pct"
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  defaultValue={property.deposit_pct}
                />
              </Field>
            </Pair>
            <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              El porcentaje de seña se aplica sobre el total de cada reserva nueva
              para calcular el anticipo que se cobra por Mercado Pago.
            </p>
          </div>
        </SettingsSection>

      </fieldset>

      {/* Acciones: fuera de las tarjetas, alineadas al borde del formulario. */}
      {!readOnly && (
        <div className="flex justify-end gap-2 lg:pl-[280px]">
          <Button type="reset" variant="outline" disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      )}
    </form>
  )
}
