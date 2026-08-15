import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PublicBooking } from "@/components/public/public-booking"

export const dynamic = "force-dynamic"

type PublicProperty = {
  name: string
  description: string | null
  city: string | null
  currency: string
  checkin_time: string
  checkout_time: string
}

export default async function ReservarPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("public_property", {
    p_org_slug: slug,
    p_property_slug: null,
  })

  if (error || !data) notFound()

  const { data: mpRaw } = await supabase.rpc("mp_public_status", {
    p_org_slug: slug,
  })
  const mpEnabled = Boolean((mpRaw as { enabled?: boolean } | null)?.enabled)

  return (
    <PublicBooking
      orgSlug={slug}
      property={data as PublicProperty}
      mpEnabled={mpEnabled}
    />
  )
}
