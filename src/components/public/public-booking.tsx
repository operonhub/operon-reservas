"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatCurrency, nightsBetween, todayISO, addDays } from "@/lib/format"
import {
  searchAvailability,
  bookPublic,
  type AvailUnit,
} from "@/app/(public)/reservar/[slug]/actions"
import { MapPin, Clock, Users, CheckCircle2, ArrowLeft } from "lucide-react"

type PublicProperty = {
  name: string
  description: string | null
  city: string | null
  currency: string
  checkin_time: string
  checkout_time: string
}

type Step = "search" | "results" | "form" | "done"

export function PublicBooking({
  orgSlug,
  property,
}: {
  orgSlug: string
  property: PublicProperty
}) {
  const [step, setStep] = React.useState<Step>("search")
  const [pending, setPending] = React.useState(false)

  const [checkIn, setCheckIn] = React.useState(addDays(todayISO(), 7))
  const [checkOut, setCheckOut] = React.useState(addDays(todayISO(), 10))
  const [guests, setGuests] = React.useState(2)

  const [units, setUnits] = React.useState<AvailUnit[]>([])
  const [selected, setSelected] = React.useState<AvailUnit | null>(null)
  const [code, setCode] = React.useState<string | null>(null)

  const nights = React.useMemo(
    () => (checkIn && checkOut && checkOut > checkIn ? nightsBetween(checkIn, checkOut) : 0),
    [checkIn, checkOut]
  )

  async function onSearch(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    const res = await searchAvailability(orgSlug, checkIn, checkOut, guests)
    setPending(false)
    if (!res.ok) {
      toast.error(res.error ?? "Error al buscar.")
      return
    }
    setUnits(res.units ?? [])
    setStep("results")
  }

  async function onBook(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selected) return
    const fd = new FormData(e.currentTarget)
    setPending(true)
    const res = await bookPublic({
      orgSlug,
      unitId: selected.unit_id,
      checkIn,
      checkOut,
      guests,
      fullName: String(fd.get("full_name") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    })
    setPending(false)
    if (!res.ok) {
      toast.error(res.error ?? "No se pudo reservar.")
      return
    }
    setCode(res.code ?? null)
    setStep("done")
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Hero */}
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {property.name}
        </h1>
        {property.description && (
          <p className="mt-2 text-muted-foreground">{property.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
          {property.city && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-4" /> {property.city}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="size-4" /> Check-in {property.checkin_time.slice(0, 5)} · Check-out{" "}
            {property.checkout_time.slice(0, 5)}
          </span>
        </div>
      </header>

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        {step === "search" && (
          <form onSubmit={onSearch} className="space-y-4">
            <h2 className="text-lg font-medium">Reservá tu estadía</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ci">Ingreso</Label>
                <Input id="ci" type="date" min={todayISO()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="co">Salida</Label>
                <Input id="co" type="date" min={addDays(checkIn || todayISO(), 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="g">Huéspedes</Label>
                <Input id="g" type="number" min={1} value={guests} onChange={(e) => setGuests(Number(e.target.value))} required />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {nights > 0 ? `${nights} noche${nights > 1 ? "s" : ""}` : "Elegí las fechas"}
              </p>
              <Button type="submit" disabled={pending || nights <= 0}>
                {pending ? "Buscando…" : "Buscar disponibilidad"}
              </Button>
            </div>
          </form>
        )}

        {step === "results" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">Unidades disponibles</h2>
                <p className="text-sm text-muted-foreground">
                  {checkIn} → {checkOut} · {nights} noche{nights > 1 ? "s" : ""} · {guests}{" "}
                  <Users className="inline size-3.5" />
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStep("search")}>
                <ArrowLeft /> Cambiar
              </Button>
            </div>

            {units.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No hay unidades disponibles para esas fechas. Probá con otras.
              </div>
            ) : (
              <ul className="space-y-3">
                {units.map((u) => {
                  const total = Number(u.price_per_night) * nights
                  return (
                    <li
                      key={u.unit_id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
                    >
                      <div>
                        <p className="font-medium">{u.name}</p>
                        {u.description && (
                          <p className="text-sm text-muted-foreground">{u.description}</p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Hasta {u.capacity} huéspedes ·{" "}
                          {formatCurrency(u.price_per_night, u.currency)}/noche
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold tabular-nums">
                          {formatCurrency(total, u.currency)}
                        </p>
                        <p className="text-xs text-muted-foreground">{nights} noches</p>
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            setSelected(u)
                            setStep("form")
                          }}
                        >
                          Reservar
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {step === "form" && selected && (
          <form onSubmit={onBook} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Tus datos</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("results")}>
                <ArrowLeft /> Volver
              </Button>
            </div>

            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <span className="font-medium">{selected.name}</span> · {checkIn} → {checkOut} ·{" "}
              {nights} noche{nights > 1 ? "s" : ""} ·{" "}
              <span className="font-medium">
                {formatCurrency(Number(selected.price_per_night) * nights, selected.currency)}
              </span>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="full_name">Nombre y apellido</Label>
              <Input id="full_name" name="full_name" required placeholder="Juan Pérez" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="juan@mail.com" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="phone">Teléfono / WhatsApp</Label>
                <Input id="phone" name="phone" placeholder="+54 9 351…" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notes">Comentarios (opcional)</Label>
              <Textarea id="notes" name="notes" rows={2} placeholder="Llegada aproximada, mascotas, etc." />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Confirmando…" : "Confirmar reserva"}
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              La disponibilidad se vuelve a validar al confirmar.
            </p>
          </form>
        )}

        {step === "done" && (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
            <h2 className="mt-3 text-xl font-semibold">¡Reserva generada!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Guardá tu código de reserva. El alojamiento se pondrá en contacto para confirmar.
            </p>
            {code && (
              <p className="mx-auto mt-4 w-fit rounded-lg bg-muted px-4 py-2 font-mono text-lg font-semibold">
                {code}
              </p>
            )}
            {selected && (
              <p className="mt-4 text-sm text-muted-foreground">
                {selected.name} · {checkIn} → {checkOut}
              </p>
            )}
            <Button
              variant="outline"
              className="mt-6"
              onClick={() => {
                setStep("search")
                setSelected(null)
                setUnits([])
                setCode(null)
              }}
            >
              Hacer otra reserva
            </Button>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Reservas gestionadas con Operon Reservas
      </p>
    </div>
  )
}
