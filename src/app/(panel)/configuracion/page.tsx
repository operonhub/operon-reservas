import { Suspense } from "react"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { ConfigForm } from "@/components/settings/config-form"
import {
  MercadoPagoCard,
  type MpStatus,
} from "@/components/settings/mercadopago-card"
import { OperonArc } from "@/components/brand/operon-arc"
import { ENTER } from "@/lib/motion"
import { isMercadoPagoConfigured } from "@/lib/mercadopago"

export default async function ConfiguracionPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, name, description, phone, whatsapp, email, address, city, currency, checkin_time, checkout_time, deposit_pct"
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  const { data: mpRaw } = await supabase.rpc("mp_connection_status")
  const mpStatus = (mpRaw ?? { connected: false }) as MpStatus

  return (
    <div className="relative p-6 pb-12">
      <OperonArc className="inset-0" size={560} thickness={70} corner="bottom-right" />

      <header className={`${ENTER} mb-8 max-w-2xl`}>
        <p className="label-mono text-primary">{ctx.organizationName}</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold">Configuración</h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          Datos de la propiedad, canales de contacto y reglas de operación. Se
          aplican a todas las unidades del alojamiento.
        </p>
      </header>

      <div className="max-w-5xl space-y-8">
        {property ? (
          <ConfigForm property={property} />
        ) : (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No hay una propiedad configurada.
          </div>
        )}

        {/* Separado del formulario a propósito: la integración se conecta y
            desconecta sola, no se guarda con el botón de arriba. */}
        <div className={`${ENTER} flex items-center gap-3 pt-4`}>
          <span className="label-mono text-muted-foreground">Integraciones</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Suspense>
          <MercadoPagoCard status={mpStatus} configured={isMercadoPagoConfigured()} />
        </Suspense>
      </div>
    </div>
  )
}
