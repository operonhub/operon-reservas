"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { deleteRate } from "@/app/(panel)/tarifas/actions"

export function RateDeleteButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  async function onClick() {
    if (!confirm("¿Eliminar esta tarifa?")) return
    setPending(true)
    const res = await deleteRate(id)
    setPending(false)
    if (res.ok) {
      toast.success("Tarifa eliminada.")
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo eliminar.")
    }
  }

  return (
    <Button variant="ghost" size="sm" className="text-destructive" onClick={onClick} disabled={pending}>
      Eliminar
    </Button>
  )
}
