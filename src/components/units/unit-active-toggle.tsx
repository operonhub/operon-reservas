"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { toggleUnitActive } from "@/app/(panel)/unidades/actions"

export function UnitActiveToggle({
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
    const res = await toggleUnitActive(id, !isActive)
    setPending(false)
    if (res.ok) {
      toast.success(isActive ? "Unidad desactivada." : "Unidad activada.")
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo actualizar.")
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={pending}
      className="text-muted-foreground"
    >
      {isActive ? "Desactivar" : "Activar"}
    </Button>
  )
}
