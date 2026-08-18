import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { UnitDialog } from "@/components/units/unit-dialog"
import { UnitCard, type UnitCardData } from "@/components/units/unit-card"
import { OperonArc } from "@/components/brand/operon-arc"
import { ENTER } from "@/lib/motion"
import { todayISO, addDays, nightsBetween } from "@/lib/format"
import { sanitizeAmenities } from "@/lib/amenities"
import { Plus } from "lucide-react"

const HORIZON_DAYS = 30

function parseRange(raw: string): { start: string; endExclusive: string } | null {
  const m = raw.match(/\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)/)
  return m ? { start: m[1], endExclusive: m[2] } : null
}

export default async function UnidadesPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const today = todayISO()
  const horizon = addDays(today, HORIZON_DAYS)

  // Todo acotado a la org del usuario por RLS.
  const [{ data: properties }, { data: units }, { data: occ }] = await Promise.all([
    supabase.from("properties").select("id, name").order("name"),
    supabase
      .from("units")
      .select(
        "id, name, description, capacity, is_active, photo_path, amenities, properties(name)"
      )
      .order("position", { ascending: true }),
    // Ocupación del horizonte: alimenta el estado de "ahora", la próxima
    // llegada y el porcentaje de ocupación de cada unidad.
    supabase
      .from("unit_occupancy")
      .select("unit_id, during, kind, block_reason, reservations(guests(full_name))")
      .overlaps("during", `[${today},${horizon})`),
  ])

  const props = properties ?? []

  const spans = (occ ?? []).flatMap((o) => {
    const r = parseRange(o.during as unknown as string)
    if (!r) return []
    type G = { full_name: string }
    const resRaw = o.reservations as { guests: G | G[] | null } | { guests: G | G[] | null }[] | null
    const res = Array.isArray(resRaw) ? resRaw[0] : resRaw
    const g = res?.guests
    const guestName = (Array.isArray(g) ? g[0]?.full_name : g?.full_name) ?? null
    return [{ unitId: o.unit_id, ...r, kind: o.kind, blockReason: o.block_reason, guestName }]
  })

  const list: UnitCardData[] = (units ?? []).map((u) => {
    const mine = spans.filter((s) => s.unitId === u.id)

    // Qué está pasando AHORA: el tramo que cubre el día de hoy.
    const current = mine.find((s) => s.start <= today && s.endExclusive > today)
    // Qué viene: el primer tramo que arranca a futuro.
    const next = mine
      .filter((s) => s.start > today)
      .sort((a, b) => (a.start > b.start ? 1 : -1))[0]

    const bookedNights = mine
      .filter((s) => s.kind === "reservation")
      .reduce((sum, s) => {
        const from = s.start > today ? s.start : today
        const to = s.endExclusive < horizon ? s.endExclusive : horizon
        return sum + Math.max(0, nightsBetween(from, to))
      }, 0)

    const prop = u.properties as { name: string } | { name: string }[] | null

    return {
      id: u.id,
      name: u.name,
      description: u.description,
      capacity: u.capacity,
      isActive: u.is_active,
      photoPath: u.photo_path,
      amenities: sanitizeAmenities((u.amenities as string[] | null) ?? []),
      propertyName: Array.isArray(prop) ? prop[0]?.name : prop?.name,
      current: current
        ? {
            kind: current.kind,
            until: current.endExclusive,
            label: current.kind === "block" ? current.blockReason : current.guestName,
          }
        : null,
      nextArrival: next?.start ?? null,
      occupancyPct: Math.round((bookedNights / HORIZON_DAYS) * 100),
      horizonDays: HORIZON_DAYS,
    }
  })

  return (
    <div className="relative p-6 space-y-6">
      <OperonArc className="inset-0" size={560} thickness={70} corner="bottom-right" />

      <header className={`${ENTER} flex flex-wrap items-end justify-between gap-4`}>
        <div>
          <p className="label-mono text-primary">{ctx.organizationName}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold">Unidades</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {list.length} {list.length === 1 ? "unidad" : "unidades"} · cabañas, lofts
            y habitaciones reservables
          </p>
        </div>
        {props.length > 0 && (
          <UnitDialog
            mode="new"
            properties={props}
            organizationId={ctx.organizationId}
            triggerLabel="Nueva unidad"
            triggerIcon={<Plus />}
          />
        )}
      </header>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Todavía no cargaste unidades.
        </div>
      ) : (
        <div className="relative grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((u, i) => (
            <UnitCard
              key={u.id}
              unit={u}
              properties={props}
              organizationId={ctx.organizationId}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  )
}
