import Link from "next/link"
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

export default async function HuespedesPage() {
  const ctx = await requireContext()
  const supabase = await createClient()

  const { data: guests } = await supabase
    .from("guests")
    .select("id, full_name, email, phone, reservations(count)")
    .order("full_name", { ascending: true })

  const list = guests ?? []

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Huéspedes</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.organizationName} — se identifican por email para no duplicar
        </p>
      </header>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Todavía no hay huéspedes. Se crean solos al cargar o recibir reservas.
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead className="text-center">Reservas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((g) => {
                const rc = g.reservations as { count: number }[] | null
                const count = rc?.[0]?.count ?? 0
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">
                      <Link href={`/huespedes/${g.id}`} className="hover:underline">
                        {g.full_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{g.email ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{g.phone ?? "—"}</TableCell>
                    <TableCell className="text-center tabular-nums">{count}</TableCell>
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
