import { Suspense } from "react"
import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { ConfigForm } from "@/components/settings/config-form"
import {
  MercadoPagoCard,
  type MpStatus,
} from "@/components/settings/mercadopago-card"
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
    <div className="p-6 space-y-6 max-w-2xl">
      <header>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.organizationName} — datos y operación del alojamiento
        </p>
      </header>

      {property ? (
        <ConfigForm property={property} />
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No hay una propiedad configurada.
        </div>
      )}

      <Suspense>
        <MercadoPagoCard status={mpStatus} configured={isMercadoPagoConfigured()} />
      </Suspense>
    </div>
  )
}
