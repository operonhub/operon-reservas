import { Suspense } from "react"
import { requireContext } from "@/lib/auth"
import { canManageSettings } from "@/lib/roles"
import { ReadOnlyNotice } from "@/components/panel/read-only-notice"
import { createClient } from "@/lib/supabase/server"
import { ConfigForm } from "@/components/settings/config-form"
import { HomeBannerField } from "@/components/settings/home-banner-field"
import {
  MercadoPagoCard,
  type MpStatus,
} from "@/components/settings/mercadopago-card"
import { OperonArc } from "@/components/brand/operon-arc"
import { ENTER_VIEW } from "@/lib/motion"
import { isMercadoPagoConfigured } from "@/lib/mercadopago"
import {
  HOME_BANNER_FILENAME,
  UNIT_PHOTOS_BUCKET,
  homeBannerFolder,
} from "@/lib/storage"
import { cookies } from "next/headers"

export default async function ConfiguracionPage() {
  const ctx = await requireContext()
  const canEdit = canManageSettings(ctx.role)
  const isDemo = (await cookies()).get("operon_demo")?.value === "1"
  const supabase = await createClient()

  const [{ data: property }, { data: bannerFiles }, { data: mpRaw }] =
    await Promise.all([
      supabase
        .from("properties")
        .select(
          "id, name, description, phone, whatsapp, email, address, city, currency, checkin_time, checkout_time, deposit_pct"
        )
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.storage
        .from(UNIT_PHOTOS_BUCKET)
        .list(homeBannerFolder(ctx.organizationId), {
          limit: 10,
          search: HOME_BANNER_FILENAME,
        }),
      supabase.rpc("mp_connection_status"),
    ])
  const mpStatus = (mpRaw ?? { connected: false }) as MpStatus
  const bannerFile = bannerFiles?.find(
    (file) => file.name === HOME_BANNER_FILENAME
  )

  return (
    <div className="relative p-4 pb-12 sm:p-6">
      <OperonArc className="inset-0" size={560} thickness={70} corner="bottom-right" />

      <header className={`${ENTER_VIEW} mb-8 max-w-2xl`}>
        <p className="label-mono text-primary">{ctx.organizationName}</p>
        <h1 className="mt-1 text-2xl leading-tight font-semibold sm:text-[28px]">Configuración</h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          Datos de la propiedad, canales de contacto y reglas de operación. Se
          aplican a todas las unidades del alojamiento.
        </p>
      </header>

      <div className="max-w-5xl space-y-8">
        {!canEdit && <ReadOnlyNotice />}
        {property ? (
          <>
            <ConfigForm property={property} readOnly={!canEdit} />
            {!isDemo && canEdit && <HomeBannerField
              organizationId={ctx.organizationId}
              initialVersion={bannerFile?.updated_at ?? bannerFile?.created_at}
            />}
            {isDemo && <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">Portada e integraciones desactivadas en la demo. Los datos de la propiedad son ficticios.</div>}
          </>
        ) : (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No hay una propiedad configurada.
          </div>
        )}

        {/* Separado del formulario a propósito: la integración se conecta y
            desconecta sola, no se guarda con el botón de arriba. */}
        {!isDemo && <div className={`${ENTER_VIEW} flex items-center gap-3 pt-4`}>
          <span className="label-mono text-muted-foreground">Integraciones</span>
          <span className="h-px flex-1 bg-border" />
        </div>}

        {!isDemo && <Suspense>
          <MercadoPagoCard status={mpStatus} configured={isMercadoPagoConfigured()} readOnly={!canEdit} />
        </Suspense>}
      </div>
    </div>
  )
}
