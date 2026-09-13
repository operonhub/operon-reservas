"use client"

import * as React from "react"
import { Check, Copy, LoaderCircle, MessageCircle, Plus } from "lucide-react"
import { OperonArc } from "@/components/brand/operon-arc"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { createInvitation, revokeInvitation, type CreateInvitationState } from "./actions"

export type InvitationRow = {
  id: string
  email: string | null
  note: string | null
  created_at: string
  expires_at: string
  status: "valid" | "used" | "expired" | "revoked"
  redeemed_at: string | null
  redeemed_email: string | null
  organization_name: string | null
}

const STATUS: Record<InvitationRow["status"], { label: string; className: string }> = {
  valid: { label: "Vigente", className: "bg-primary/10 text-primary" },
  used: { label: "Usada", className: "bg-success/15 text-success" },
  expired: { label: "Vencida", className: "bg-muted text-muted-foreground" },
  revoked: { label: "Anulada", className: "bg-destructive/10 text-destructive" },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })
}

export function InvitationsAdmin({ invitations }: { invitations: InvitationRow[] }) {
  const [state, formAction, pending] = React.useActionState<CreateInvitationState, FormData>(
    createInvitation,
    null
  )

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <OperonArc className="inset-0" size={520} thickness={64} corner="bottom-right" />

      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <header>
          <p className="label-mono text-primary">Operon · uso interno</p>
          <h1 className="mt-1 text-2xl leading-tight font-semibold sm:text-[28px]">Invitaciones</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Generá un link para que un cliente nuevo cree su cuenta y configure su complejo. Sirve
            una sola vez y vence a los 7 días.
          </p>
        </header>

        <section className="mt-6 rounded-2xl border bg-card p-5 shadow-sm">
          <form action={formAction} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="note">Cliente</Label>
              <Input id="note" name="note" placeholder="Cabañas del Lago" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email (opcional)</Label>
              <Input id="email" name="email" type="email" placeholder="Solo esa cuenta podrá usarla" />
            </div>
            <Button type="submit" disabled={pending} className="h-9 px-3.5">
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Generar link
            </Button>
          </form>

          {state?.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state?.link && <GeneratedLink key={state.link} link={state.link} note={state.note} />}
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
          {invitations.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Todavía no generaste invitaciones.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    {["Cliente", "Estado", "Creada", "Detalle", ""].map((h) => (
                      <th key={h} className="label-mono px-4 py-2.5 font-normal text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-medium">{inv.note ?? "Sin nombre"}</p>
                        {inv.email && <p className="text-xs text-muted-foreground">{inv.email}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "label-mono rounded-md px-2 py-1",
                            STATUS[inv.status].className
                          )}
                        >
                          {STATUS[inv.status].label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">
                        {formatDate(inv.created_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {inv.status === "valid" && `Vence el ${formatDate(inv.expires_at)}`}
                        {inv.status === "used" &&
                          `${inv.organization_name ?? "Configurando…"} · ${inv.redeemed_email ?? ""}`}
                        {(inv.status === "expired" || inv.status === "revoked") && "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inv.status === "valid" && <RevokeButton id={inv.id} note={inv.note} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function GeneratedLink({ link, note }: { link: string; note?: string }) {
  const [copied, setCopied] = React.useState(false)
  const message = `¡Hola! Te paso el link para crear tu cuenta en Operon Reservas y configurar ${
    note ?? "tu complejo"
  }: ${link}`

  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-accent/60 p-4">
      <p className="label-mono text-accent-foreground">
        Link generado · copialo ahora, no se vuelve a mostrar
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border bg-background px-3 py-2 font-mono text-xs">
          {link}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(link)
            setCopied(true)
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "sm" })}
        >
          <MessageCircle /> Mandar por WhatsApp
        </a>
      </div>
    </div>
  )
}

function RevokeButton({ id, note }: { id: string; note: string | null }) {
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-destructive hover:text-destructive"
      onClick={() => {
        if (!confirm(`¿Anular la invitación de ${note ?? "este cliente"}? El link deja de funcionar.`)) return
        startTransition(async () => {
          const result = await revokeInvitation(id)
          if (result.error) alert(result.error)
        })
      }}
    >
      Anular
    </Button>
  )
}
