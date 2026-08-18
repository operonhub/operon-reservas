import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { RateDialog } from "@/components/rates/rate-dialog"
import { UnitRatesCard, RuleLine } from "@/components/rates/unit-rates-card"
import { PriceSimulator } from "@/components/rates/price-simulator"
import { OperonArc } from "@/components/brand/operon-arc"
import { ENTER, ENTER_UP, stagger } from "@/lib/motion"
import type { RateRow } from "@/lib/rate-rules"
import { Plus, Globe } from "lucide-react"

export default async function TarifasPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const [{ data: property }, { data: units }, { data: rates }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, currency")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase.from("units").select("id, name, capacity").eq("is_active", true).order("position"),
    supabase
      .from("rates")
      .select(
        "id, unit_id, kind, label, price_per_night, discount_pct, weekdays, min_guests, max_guests, min_nights, min_nights_rule, priority, start_date, end_date, is_active, currency"
      )
      .order("priority", { ascending: false }),
  ])

  const unitList = units ?? []
  const all = (rates ?? []) as RateRow[]
  const currency = property?.currency ?? "ARS"

  // Las reglas sin unidad valen para todas: se muestran aparte para no
  // repetirlas en cada tarjeta y que parezcan varias reglas distintas.
  const globalRules = all.filter((r) => r.unit_id === null && r.kind !== "base")
  const globalBase = all.find((r) => r.unit_id === null && r.kind === "base") ?? null

  return (
    <div className="relative p-6 space-y-6">
      <OperonArc className="inset-0" size={560} thickness={70} corner="bottom-right" />

      <header className={`${ENTER} flex flex-wrap items-end justify-between gap-4`}>
        <div>
          <p className="label-mono text-primary">{ctx.organizationName}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold">Tarifas</h1>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            Precio base de cada unidad y reglas que lo modifican por fecha, día
            o tipo de estadía.
          </p>
        </div>
        {property && (
          <RateDialog
            mode="new"
            units={unitList}
            propertyId={property.id}
            triggerLabel="Nueva regla"
            triggerIcon={<Plus />}
          />
        )}
      </header>

      {unitList.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Cargá unidades antes de definir tarifas.
        </div>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-2">
            {unitList.map((u, i) => (
              <UnitRatesCard
                key={u.id}
                unit={u}
                base={all.find((r) => r.unit_id === u.id && r.kind === "base") ?? globalBase}
                baseIsInherited={!all.some((r) => r.unit_id === u.id && r.kind === "base")}
                rules={all.filter((r) => r.unit_id === u.id && r.kind !== "base")}
                units={unitList}
                propertyId={property?.id ?? ""}
                currency={currency}
                index={i}
              />
            ))}
          </div>

          {globalRules.length > 0 && (
            <section className={ENTER_UP} style={stagger(unitList.length)}>
              <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold tracking-tight">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Globe className="size-4" />
                </span>
                Reglas para todas las unidades
              </h2>
              <div className="space-y-2 rounded-2xl border bg-card p-4">
                {globalRules.map((r) => (
                  <RuleLine
                    key={r.id}
                    rule={r}
                    units={unitList}
                    propertyId={property?.id ?? ""}
                    currency={currency}
                    base={globalBase}
                  />
                ))}
              </div>
            </section>
          )}

          {property && (
            <div className={ENTER_UP} style={stagger(unitList.length + 1)}>
              <PriceSimulator units={unitList} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

