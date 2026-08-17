"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatCurrency, nightsBetween, todayISO, addDays } from "@/lib/format"
import { ENTER, ENTER_UP, ENTER_SIDE, ENTER_POP, stagger } from "@/lib/motion"
import { OperonFooter } from "@/components/public/operon-footer"
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
  deposit_pct: number
  whatsapp: string | null
  phone: string | null
}

type Step = "search" | "results" | "form" | "done"

export function PublicBooking({
  orgSlug,
  property,
  mpEnabled = false,
}: {
  orgSlug: string
  property: PublicProperty
  mpEnabled?: boolean
}) {
  const [step, setStep] = React.useState<Step>("search")
  const [pending, setPending] = React.useState(false)
  const [paying, setPaying] = React.useState(false)

  const [checkIn, setCheckIn] = React.useState(addDays(todayISO(), 7))
  const [checkOut, setCheckOut] = React.useState(addDays(todayISO(), 10))
  const [guests, setGuests] = React.useState(2)

  const [units, setUnits] = React.useState<AvailUnit[]>([])
  const [selected, setSelected] = React.useState<AvailUnit | null>(null)
  const [code, setCode] = React.useState<string | null>(null)
  const [booked, setBooked] = React.useState<{
    total: number | null
    deposit: number | null
  } | null>(null)

  const nights = React.useMemo(
    () => (checkIn && checkOut && checkOut > checkIn ? nightsBetween(checkIn, checkOut) : 0),
    [checkIn, checkOut]
  )

  const depositPct = Number(property.deposit_pct) || 0

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
    setBooked({ total: res.total_amount ?? null, deposit: res.deposit_amount ?? null })
    setStep("done")
  }

  async function onPay() {
    if (!code) return
    setPaying(true)
    try {
      const res = await fetch("/api/mp/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, orgSlug }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        init_point?: string
      }
      if (!res.ok || !data.init_point) {
        toast.error("No se pudo iniciar el pago. Probá de nuevo.")
        setPaying(false)
        return
      }
      window.location.href = data.init_point
    } catch {
      toast.error("No se pudo iniciar el pago. Probá de nuevo.")
      setPaying(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* Hero — el 80% de la venta se decide acá */}
      <header className="mb-8">
        <h1
          className={`${ENTER_UP} text-4xl font-semibold text-balance sm:text-5xl`}
          style={stagger(0)}
        >
          {property.name}
        </h1>
        {property.description && (
          <p
            className={`${ENTER_UP} mt-3 max-w-xl text-lg text-pretty text-muted-foreground`}
            style={stagger(1)}
          >
            {property.description}
          </p>
        )}
        <div
          className={`${ENTER} label-mono mt-4 flex flex-wrap gap-4 text-muted-foreground`}
          style={stagger(2)}
        >
          {property.city && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {property.city}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" /> Check-in {property.checkin_time.slice(0, 5)} · Check-out{" "}
            {property.checkout_time.slice(0, 5)}
          </span>
        </div>
      </header>

      <div
        className={`${ENTER_UP} rounded-2xl border bg-card p-6 shadow-sm`}
        style={stagger(3)}
      >
        {step === "search" && (
          <form onSubmit={onSearch} className={`${ENTER} space-y-4`}>
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
          <div className={`${ENTER_SIDE} space-y-4`}>
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
                {units.map((u, i) => {
                  const total = Number(u.price_per_night) * nights
                  const deposit = depositPct > 0 ? Math.round((total * depositPct) / 100) : null
                  return (
                    <li
                      key={u.unit_id}
                      className={`${ENTER_UP} flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 transition-all hover:border-primary/40 hover:shadow-md`}
                      style={stagger(i, 80)}
                    >
                      <div>
                        <p className="font-heading font-medium tracking-tight">
                          {u.name}
                        </p>
                        {u.description && (
                          <p className="text-sm text-muted-foreground">{u.description}</p>
                        )}
                        <p className="label-mono mt-1.5 text-muted-foreground">
                          Hasta {u.capacity} huéspedes ·{" "}
                          {formatCurrency(u.price_per_night, u.currency)}/noche
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xl font-medium tabular-nums">
                          {formatCurrency(total, u.currency)}
                        </p>
                        <p className="label-mono text-muted-foreground">
                          {nights} noche{nights > 1 ? "s" : ""} en total
                        </p>
                        {deposit != null && (
                          <p className="label-mono text-muted-foreground">
                            Seña ({depositPct}%): {formatCurrency(deposit, u.currency)}
                          </p>
                        )}
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
          <form onSubmit={onBook} className={`${ENTER_SIDE} space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Tus datos</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep("results")}>
                <ArrowLeft /> Volver
              </Button>
            </div>

            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <p>
                <span className="font-medium">{selected.name}</span> · {checkIn} → {checkOut} ·{" "}
                {nights} noche{nights > 1 ? "s" : ""} ·{" "}
                <span className="font-medium">
                  {formatCurrency(Number(selected.price_per_night) * nights, selected.currency)}
                </span>
              </p>
              {depositPct > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Para confirmar se paga una seña del {depositPct}% — el resto se abona en el
                  alojamiento.
                </p>
              )}
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
          <div className={`${ENTER_POP} py-6 text-center`}>
            <CheckCircle2 className="mx-auto size-12 text-success" />
            <h2 className="mt-3 text-xl font-semibold">¡Reserva generada!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mpEnabled
                ? "Pagá la seña para confirmarla al instante — el resto se abona al llegar."
                : "Guardá tu código. El alojamiento se pondrá en contacto para confirmar."}
            </p>
            {code && (
              <p
                className={`${ENTER_UP} mx-auto mt-4 w-fit rounded-lg bg-muted px-4 py-2 font-mono text-lg font-semibold`}
                style={stagger(1)}
              >
                {code}
              </p>
            )}
            {selected && (
              <p className="mt-4 text-sm text-muted-foreground">
                {selected.name} ·{" "}
                <span className="font-mono tabular-nums">
                  {checkIn} → {checkOut}
                </span>
              </p>
            )}

            {booked && (booked.total != null || booked.deposit != null) && (
              <dl
                className={`${ENTER_UP} mx-auto mt-4 w-fit space-y-1 rounded-xl border bg-muted/40 p-3 text-left text-sm`}
                style={stagger(2)}
              >
                {booked.total != null && (
                  <div className="flex justify-between gap-6">
                    <dt className="text-muted-foreground">Total</dt>
                    <dd className="font-mono font-medium tabular-nums">
                      {formatCurrency(booked.total, property.currency)}
                    </dd>
                  </div>
                )}
                {booked.deposit != null && (
                  <div className="flex justify-between gap-6">
                    <dt className="text-muted-foreground">Seña a pagar ahora</dt>
                    <dd className="font-mono font-medium tabular-nums">
                      {formatCurrency(booked.deposit, property.currency)}
                    </dd>
                  </div>
                )}
                {booked.total != null && booked.deposit != null && (
                  <div className="flex justify-between gap-6">
                    <dt className="text-muted-foreground">Saldo (en el alojamiento)</dt>
                    <dd className="font-mono font-medium tabular-nums">
                      {formatCurrency(booked.total - booked.deposit, property.currency)}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {mpEnabled && (
              <div className={ENTER_UP} style={stagger(3)}>
                <Button
                  onClick={onPay}
                  disabled={paying}
                  size="lg"
                  className="mt-6 w-full sm:w-auto"
                >
                  {paying ? "Redirigiendo a Mercado Pago…" : "Pagar seña con Mercado Pago"}
                </Button>
              </div>
            )}

            {property.whatsapp && (
              <div className="mt-4">
                <a
                  href={`https://wa.me/${property.whatsapp}?text=${encodeURIComponent(
                    `¡Hola! Acabo de reservar${code ? ` (código ${code})` : ""} y quería confirmar los detalles.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground underline underline-offset-4"
                >
                  Hablar con el alojamiento por WhatsApp
                </a>
              </div>
            )}

            <div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-4 text-muted-foreground"
                onClick={() => {
                  setStep("search")
                  setSelected(null)
                  setUnits([])
                  setCode(null)
                  setBooked(null)
                }}
              >
                Hacer otra reserva
              </Button>
            </div>
          </div>
        )}
      </div>

      <OperonFooter />
    </div>
  )
}
