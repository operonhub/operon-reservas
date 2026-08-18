"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { toggleRateActive } from "@/app/(panel)/tarifas/actions"
import { Eye, EyeOff } from "lucide-react"

/** Apaga o enciende una promo sin perder su configuración. */
export function RateActiveToggle({
  id,
  isActive,
}: {
  id: string
  isActive: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  async function onClick() {
    setPending(true)
    const res = await toggleRateActive(id, !isActive)
    setPending(false)
    if (res.ok) {
      toast.success(isActive ? "Regla desactivada." : "Regla activada.")
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo cambiar el estado.")
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      title={isActive ? "Desactivar regla" : "Activar regla"}
      aria-label={isActive ? "Desactivar regla" : "Activar regla"}
    >
      {isActive ? <Eye /> : <EyeOff className="text-muted-foreground" />}
    </Button>
  )
}
