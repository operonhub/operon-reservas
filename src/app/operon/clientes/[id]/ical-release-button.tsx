"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { releaseIcalBlock, type ActionState } from "./actions"

/**
 * Libera una fecha importada que quedó en duda (0044). Dos pasos, porque
 * liberar de más es una sobreventa: primero "Liberar", después confirmar.
 */
export function IcalReleaseButton({ orgId, id, label }: { orgId: string; id: string; label: string }) {
  const [confirming, setConfirming] = React.useState(false)
  const [, action, pending] = React.useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await releaseIcalBlock(prev, formData)
    if (result?.error) toast.error(result.error)
    else toast.success("Fecha liberada.")
    setConfirming(false)
    return result
  }, null)

  if (!confirming) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Liberar
      </Button>
    )
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-muted-foreground">¿El cliente confirmó que se canceló?</span>
      <Button type="submit" variant="destructive" size="sm" disabled={pending} aria-label={`Liberar ${label}`}>
        {pending ? "Liberando…" : "Sí, liberar"}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        No
      </Button>
    </form>
  )
}
