"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SettingsSection } from "@/components/settings/settings-section"
import { cn } from "@/lib/utils"
import { disconnectMercadoPago } from "@/app/(panel)/configuracion/actions"
import { CreditCard, CircleCheck, Link2, Unplug } from "lucide-react"

export type MpStatus = {
  connected: boolean
  mp_user_id?: string
  live_mode?: boolean
  connected_at?: string
  expires_at?: string
}

const FEEDBACK: Record<string, { ok: boolean; msg: string }> = {
  connected: { ok: true, msg: "Mercado Pago conectado correctamente." },
  denied: { ok: false, msg: "Cancelaste la autorización de Mercado Pago." },
  invalid_state: { ok: false, msg: "El enlace de conexión venció. Probá de nuevo." },
  exchange_failed: { ok: false, msg: "No se pudo completar la conexión con Mercado Pago." },
  not_configured: {
    ok: false,
    msg: "Mercado Pago todavía no está habilitado a nivel plataforma.",
  },
  error: { ok: false, msg: "No se pudo iniciar la conexión con Mercado Pago." },
}

export function MercadoPagoCard({
  status,
  configured,
}: {
  status: MpStatus
  configured: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, setPending] = React.useState(false)

  // Feedback del retorno del OAuth (?mp=...), una sola vez, y limpia la URL.
  React.useEffect(() => {
    const code = searchParams.get("mp")
    if (!code) return
    const f = FEEDBACK[code]
    if (f) (f.ok ? toast.success : toast.error)(f.msg)
    router.replace("/configuracion")
  }, [searchParams, router])

  async function handleDisconnect() {
    if (!confirm("¿Desconectar Mercado Pago? Dejarás de poder cobrar online.")) return
    setPending(true)
    const res = await disconnectMercadoPago()
    setPending(false)
    if (res.ok) {
      toast.success("Mercado Pago desconectado.")
      router.refresh()
    } else {
      toast.error(res.error ?? "No se pudo desconectar.")
    }
  }

  return (
    <SettingsSection
      icon={CreditCard}
      title="Cobros con Mercado Pago"
      description="Conectá tu cuenta para cobrar la seña online. El dinero entra directo a vos: Operon no retiene ni intermedia."
      index={4}
    >
      {status.connected ? (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/10 p-4">
            <span className="flex items-center gap-2 font-semibold">
              <CircleCheck className="size-4 text-success" /> Cuenta conectada
            </span>
            <Badge
              className={cn(
                "label-mono border-transparent",
                status.live_mode
                  ? "bg-success/20 text-foreground"
                  : "bg-warning/30 text-foreground"
              )}
            >
              {status.live_mode ? "Producción" : "Modo prueba"}
            </Badge>
          </div>

          <dl className="space-y-2 rounded-xl border bg-background/60 p-4">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Cuenta</dt>
              <dd className="font-mono text-xs">{status.mp_user_id}</dd>
            </div>
            {status.connected_at && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Conectada el</dt>
                <dd className="font-mono text-xs tabular-nums">
                  {new Date(status.connected_at).toLocaleDateString("es-AR")}
                </dd>
              </div>
            )}
          </dl>

          <Button variant="outline" onClick={handleDisconnect} disabled={pending}>
            <Unplug /> {pending ? "Desconectando…" : "Desconectar"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Sin la cuenta conectada, las reservas se generan igual pero el
            huésped no puede pagar la seña online.
          </p>
          {configured ? (
            <a href="/api/mp/connect" className={buttonVariants()}>
              <Link2 /> Conectar Mercado Pago
            </a>
          ) : (
            <div className="rounded-xl border border-dashed p-4 text-muted-foreground">
              La conexión estará disponible en cuanto Operon habilite Mercado
              Pago a nivel plataforma.
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
