"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { disconnectMercadoPago } from "@/app/(panel)/configuracion/actions"

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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Cobros con Mercado Pago
          {status.connected ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600">Conectado</Badge>
          ) : (
            <Badge variant="secondary">Sin conectar</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {status.connected ? (
          <>
            <p className="text-muted-foreground">
              Los pagos ingresan directo a tu cuenta de Mercado Pago. Operon no
              retiene ni intermedia el dinero.
            </p>
            <dl className="grid grid-cols-2 gap-y-1 gap-x-4">
              <dt className="text-muted-foreground">Cuenta (user id)</dt>
              <dd className="font-medium">{status.mp_user_id}</dd>
              <dt className="text-muted-foreground">Modo</dt>
              <dd className="font-medium">
                {status.live_mode ? "Producción" : "Prueba"}
              </dd>
              {status.connected_at ? (
                <>
                  <dt className="text-muted-foreground">Conectada</dt>
                  <dd className="font-medium">
                    {new Date(status.connected_at).toLocaleDateString("es-AR")}
                  </dd>
                </>
              ) : null}
            </dl>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={pending}
            >
              Desconectar
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Conectá tu cuenta de Mercado Pago para cobrar la seña de las
              reservas online. El dinero va directo a vos.
            </p>
            {configured ? (
              <a href="/api/mp/connect" className={buttonVariants()}>
                Conectar Mercado Pago
              </a>
            ) : (
              <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
                La conexión estará disponible en cuanto Operon habilite Mercado
                Pago a nivel plataforma.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
