"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RESERVATION_TRANSITIONS, RESERVATION_STATUS_LABELS } from "@/lib/constants"
import { transitionReservation } from "@/app/(panel)/reservas/actions"
import type { Enums } from "@/lib/supabase/types"

/** Acciones de transición de estado — sólo muestra las permitidas (máquina de estados única). */
export function StatusControl({
  id,
  status,
}: {
  id: string
  status: Enums<"reservation_status">
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState<string | null>(null)
  const next = RESERVATION_TRANSITIONS[status]

  if (next.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Estado final: sin transiciones disponibles.
      </p>
    )
  }

  async function go(to: Enums<"reservation_status">) {
    setPending(to)
    const res = await transitionReservation(id, to)
    setPending(null)
    if (res.ok) {
      toast.success(`Reserva → ${RESERVATION_STATUS_LABELS[to]}`)
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo cambiar el estado.")
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {next.map((to) => (
        <Button
          key={to}
          size="sm"
          variant={to === "cancelled" ? "destructive" : "outline"}
          disabled={pending !== null}
          onClick={() => go(to)}
        >
          {pending === to ? "…" : RESERVATION_STATUS_LABELS[to]}
        </Button>
      ))}
    </div>
  )
}
