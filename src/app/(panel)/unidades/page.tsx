import { requireContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UnitDialog } from "@/components/units/unit-dialog"
import { UnitActiveToggle } from "@/components/units/unit-active-toggle"
import { CopyIcalLink } from "@/components/units/copy-ical-link"
import { Plus } from "lucide-react"

export default async function UnidadesPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  // Todo acotado a la org del usuario por RLS.
  const [{ data: properties }, { data: units }] = await Promise.all([
    supabase.from("properties").select("id, name").order("name"),
    supabase
      .from("units")
      .select("id, name, description, capacity, is_active, properties(name)")
      .order("position", { ascending: true }),
  ])

  const props = properties ?? []
  const list = units ?? []

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Unidades</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.organizationName} — cabañas, lofts y habitaciones reservables
          </p>
        </div>
        {props.length > 0 && (
          <UnitDialog
            mode="new"
            properties={props}
            triggerLabel="Nueva unidad"
            triggerIcon={<Plus />}
          />
        )}
      </header>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Todavía no cargaste unidades.
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidad</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-center">Capacidad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((u) => {
                const prop = u.properties as { name: string } | { name: string }[] | null
                const propName = Array.isArray(prop) ? prop[0]?.name : prop?.name
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.name}</div>
                      {propName && (
                        <div className="text-xs text-muted-foreground">{propName}</div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                      {u.description || "—"}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {u.capacity}
                    </TableCell>
                    <TableCell>
                      {u.is_active ? (
                        <Badge variant="secondary">Activa</Badge>
                      ) : (
                        <Badge variant="outline">Inactiva</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <UnitDialog
                          mode="edit"
                          unit={u}
                          properties={props}
                          triggerLabel="Editar"
                          triggerVariant="ghost"
                          triggerSize="sm"
                        />
                        <UnitActiveToggle id={u.id} isActive={u.is_active} />
                        <CopyIcalLink unitId={u.id} />
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
