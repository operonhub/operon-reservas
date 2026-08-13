import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { RateDialog } from "@/components/rates/rate-dialog"
import { RateDeleteButton } from "@/components/rates/rate-delete-button"
import { formatCurrency } from "@/lib/format"
import { RATE_KIND_LABELS } from "@/lib/constants"

export default async function TarifasPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const [{ data: property }, { data: units }, { data: rates }] = await Promise.all([
    supabase.from("properties").select("id, currency").order("created_at").limit(1).maybeSingle(),
    supabase.from("units").select("id, name").order("position"),
    supabase
      .from("rates")
      .select("id, unit_id, kind, price_per_night, currency, min_nights, priority, start_date, end_date, units(name)")
      .order("kind")
      .order("priority", { ascending: false }),
  ])

  const unitList = units ?? []
  const list = rates ?? []
  const currency = property?.currency ?? "ARS"

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tarifas</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.organizationName} — precios por noche (base, temporada, fechas especiales)
          </p>
        </div>
        {property && (
          <RateDialog
            mode="new"
            units={unitList}
            propertyId={property.id}
            triggerLabel="Nueva tarifa"
          />
        )}
      </header>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Todavía no cargaste tarifas.
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aplica a</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Precio / noche</TableHead>
                <TableHead className="text-center">Mín. noches</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead className="text-center">Prioridad</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => {
                const unit = r.units as { name: string } | { name: string }[] | null
                const unitName = Array.isArray(unit) ? unit[0]?.name : unit?.name
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {unitName ?? "Toda la propiedad"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.kind === "base" ? "secondary" : "outline"}>
                        {RATE_KIND_LABELS[r.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(r.price_per_night, r.currency ?? currency)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{r.min_nights}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.start_date && r.end_date ? `${r.start_date} → ${r.end_date}` : "Siempre"}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{r.priority}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <RateDialog
                          mode="edit"
                          rate={{
                            id: r.id,
                            unit_id: r.unit_id,
                            kind: r.kind,
                            price_per_night: Number(r.price_per_night),
                            min_nights: r.min_nights,
                            priority: r.priority,
                            start_date: r.start_date,
                            end_date: r.end_date,
                          }}
                          units={unitList}
                          propertyId={property!.id}
                          triggerLabel="Editar"
                          triggerVariant="ghost"
                          triggerSize="sm"
                        />
                        <RateDeleteButton id={r.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
