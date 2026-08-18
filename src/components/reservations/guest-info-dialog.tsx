"use client"

import * as React from "react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { StatusBadge } from "@/components/reservations/reservation-badges"
import {
  getGuestProfile,
  type GuestProfileResult,
} from "@/app/(panel)/reservas/actions"
import { cn } from "@/lib/utils"
import {
  formatCurrency,
  formatDay,
  initials,
  whatsappHref,
} from "@/lib/format"
import {
  ArrowUpRight,
  CalendarDays,
  LoaderCircle,
  Mail,
  MessageCircle,
  Phone,
} from "lucide-react"

type LoadedGuestProfile = Extract<GuestProfileResult, { ok: true }>

export function GuestInfoDialog({
  guestId,
  children,
  triggerClassName,
}: {
  guestId: string
  children: React.ReactNode
  triggerClassName?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [profile, setProfile] = React.useState<LoadedGuestProfile | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const requestId = React.useRef(0)

  async function loadProfile() {
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)

    const result = await getGuestProfile(guestId)
    if (currentRequest !== requestId.current) return

    if (result.ok) {
      setProfile(result)
    } else {
      setProfile(null)
      setError(result.error)
    }
    setLoading(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      void loadProfile()
    } else {
      requestId.current += 1
    }
  }

  const guest = profile?.guest

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        type="button"
        className={cn(
          "inline-flex cursor-pointer items-center rounded-sm text-left underline decoration-primary/40 underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          triggerClassName
        )}
      >
        {children}
      </DialogTrigger>

      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Información del huésped</DialogTitle>
          <DialogDescription>
            Datos de contacto, notas privadas e historial de reservas.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div
            className="flex min-h-48 items-center justify-center gap-2 text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Cargando información…
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm"
          >
            {error}
          </div>
        ) : guest && profile ? (
          <div className="space-y-5">
            <section className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-sm font-semibold">
                {initials(guest.full_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-heading text-lg font-semibold tracking-tight">
                  {guest.full_name}
                </p>
                <div className="mt-2 space-y-2 text-sm">
                  {guest.email && (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {guest.email}
                      </span>
                      <a
                        href={`mailto:${guest.email}`}
                        className="label-mono rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Escribir
                      </a>
                    </div>
                  )}
                  {guest.phone && (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {guest.phone}
                      </span>
                      <a
                        href={whatsappHref(guest.phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="label-mono inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1.5 transition-colors hover:bg-success/25"
                      >
                        <MessageCircle className="size-3" /> WhatsApp
                      </a>
                    </div>
                  )}
                  {!guest.email && !guest.phone && (
                    <p className="text-muted-foreground">Sin datos de contacto.</p>
                  )}
                </div>
              </div>
            </section>

            {guest.notes && (
              <section className="space-y-2">
                <h3 className="label-mono text-muted-foreground">Notas del huésped</h3>
                <p className="rounded-xl border bg-background/60 p-3 text-sm whitespace-pre-wrap">
                  {guest.notes}
                </p>
              </section>
            )}

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="label-mono text-muted-foreground">Sus reservas</h3>
                <span className="label-mono text-muted-foreground">
                  {profile.reservations.length}
                </span>
              </div>

              {profile.reservations.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  No hay reservas asociadas a este huésped.
                </p>
              ) : (
                <ul className="divide-y overflow-hidden rounded-xl border">
                  {profile.reservations.map((reservation) => {
                    const unitRaw = reservation.units
                    const unit = Array.isArray(unitRaw) ? unitRaw[0] : unitRaw

                    return (
                      <li key={reservation.id}>
                        <Link
                          href={`/reservas/${reservation.id}`}
                          onClick={() => setOpen(false)}
                          className="group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                        >
                          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-semibold">
                                {reservation.code}
                              </span>
                              <StatusBadge status={reservation.status} />
                            </span>
                            <span className="mt-1 block truncate text-xs text-muted-foreground">
                              {unit?.name ?? "Unidad sin nombre"} ·{" "}
                              {formatDay(reservation.check_in)} →{" "}
                              {formatDay(reservation.check_out)}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-xs font-medium tabular-nums">
                              {formatCurrency(
                                reservation.total_amount,
                                reservation.currency
                              )}
                            </span>
                            <ArrowUpRight className="ml-auto mt-1 size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
