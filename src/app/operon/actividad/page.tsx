import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { dateTime } from "@/lib/operon/format"
import { ACTION_LABELS, type AuditEntry } from "@/lib/operon/types"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Actividad · Operon",
  robots: { index: false, follow: false },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const GROUPS = [
  { key: "todo", label: "Todo", match: () => true },
  { key: "suspensiones", label: "Suspensiones", match: (a: string) => a.startsWith("org.") },
  { key: "equipos", label: "Equipos y contraseñas", match: (a: string) => a.startsWith("member.") },
  { key: "invitaciones", label: "Invitaciones", match: (a: string) => a.startsWith("invitation.") },
] as const

/**
 * Registro de todo lo que hicieron los admins de Operon. Lo escribe la base
 * dentro de cada acción, así que no hay forma de hacer algo sin que quede acá.
 */
export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; tipo?: string }>
}) {
  const { org, tipo } = await searchParams
  const orgId = org && UUID.test(org) ? org : null
  const group = GROUPS.find((g) => g.key === tipo) ?? GROUPS[0]

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("operon_audit_log", { p_org: orgId ?? undefined, p_limit: 300 })
  if (error) notFound()

  const entries = ((data ?? []) as AuditEntry[]).filter((e) => group.match(e.action))
  const orgName = orgId ? entries.find((e) => e.organization_name)?.organization_name : null
  const href = (key: string) => {
    const params = new URLSearchParams()
    if (orgId) params.set("org", orgId)
    if (key !== "todo") params.set("tipo", key)
    const query = params.toString()
    return query ? `/operon/actividad?${query}` : "/operon/actividad"
  }

  return (
    <>
      <header>
        <h1 className="text-2xl leading-tight font-semibold sm:text-[28px]">Actividad</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          Todo lo que hicieron los admins de Operon: quién, cuándo y por qué. Se registra solo, en el
          mismo momento de cada acción.
        </p>
        {orgId && (
          <p className="mt-3 text-sm">
            Filtrando por <span className="font-medium">{orgName ?? "un cliente"}</span> ·{" "}
            <Link href="/operon/actividad" className="text-muted-foreground hover:text-foreground hover:underline">
              ver todo
            </Link>
          </p>
        )}
      </header>

      <nav aria-label="Tipo de acción" className="mt-6 flex flex-wrap gap-1.5">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={href(g.key)}
            aria-current={g.key === group.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              g.key === group.key ? "border-transparent bg-foreground text-background" : "hover:bg-muted"
            )}
          >
            {g.label}
          </Link>
        ))}
      </nav>

      <section className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm">
        {entries.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Todavía no hay acciones registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  {["Cuándo", "Quién", "Qué", "Cliente", "Motivo"].map((h) => (
                    <th key={h} scope="col" className="label-mono px-4 py-2.5 font-normal text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b align-top last:border-b-0">
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {dateTime(e.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs">{e.actor_email ?? "—"}</td>
                    <td className="px-4 py-3">
                      {ACTION_LABELS[e.action] ?? e.action}
                      {e.target_email && <p className="text-xs text-muted-foreground">{e.target_email}</p>}
                      {typeof e.detail.note === "string" && (
                        <p className="text-xs text-muted-foreground">{e.detail.note}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {e.organization_id ? (
                        <Link href={`/operon/clientes/${e.organization_id}`} className="hover:underline">
                          {e.organization_name ?? "Complejo eliminado"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{e.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
