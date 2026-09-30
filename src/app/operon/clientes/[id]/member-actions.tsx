"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, Copy, KeyRound, LoaderCircle, MessageCircle, UserMinus } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  createRecoveryLink,
  removeMember,
  type ActionState,
  type RecoveryState,
} from "./actions"

type Member = { user_id: string; email: string; full_name: string | null }

export function MemberActions({
  orgId,
  member,
  isLastOwner,
  isPlatformAdmin,
}: {
  orgId: string
  member: Member
  isLastOwner: boolean
  isPlatformAdmin: boolean
}) {
  return (
    <div className="flex justify-end gap-1">
      {!isPlatformAdmin && <RecoveryLinkDialog orgId={orgId} member={member} />}
      <RemoveMemberDialog orgId={orgId} member={member} disabled={isLastOwner} />
    </div>
  )
}

function RemoveMemberDialog({ orgId, member, disabled }: { orgId: string; member: Member; disabled: boolean }) {
  const [open, setOpen] = React.useState(false)
  const name = member.full_name || member.email
  const [state, formAction, pending] = React.useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await removeMember(prev, formData)
      if (result?.ok) {
        setOpen(false)
        toast.success(`${name} ya no es parte del equipo.`)
      }
      return result
    },
    null
  )

  if (disabled) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        title="Es el único dueño: no se puede quitar."
        aria-label={`No se puede quitar a ${name}: es el único dueño`}
      >
        <UserMinus />
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive hover:text-destructive")}
        aria-label={`Quitar a ${name} del equipo`}
        title="Quitar del equipo"
      >
        <UserMinus />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quitar a {name}</DialogTitle>
          <DialogDescription>
            Deja de tener acceso a este complejo. Su cuenta ({member.email}) no se borra: se puede
            volver a sumar con una invitación.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid gap-4">
          <input type="hidden" name="org" value={orgId} />
          <input type="hidden" name="user" value={member.user_id} />
          <div className="grid gap-1.5">
            <Label htmlFor={`reason-${member.user_id}`}>Motivo</Label>
            <Textarea
              id={`reason-${member.user_id}`}
              name="reason"
              rows={2}
              required
              minLength={3}
              maxLength={500}
              placeholder="Lo pidió el dueño"
            />
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" />}
              Quitar del equipo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RecoveryLinkDialog({ orgId, member }: { orgId: string; member: Member }) {
  const [open, setOpen] = React.useState(false)
  const name = member.full_name || member.email

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        aria-label={`Link de nueva contraseña para ${name}`}
        title="Link de nueva contraseña"
      >
        <KeyRound />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva contraseña para {name}</DialogTitle>
          <DialogDescription>
            Genera un link para que elija una contraseña nueva. Ustedes nunca la ven. Sirve una sola
            vez y vence en una hora. No se manda por mail: copialo y mandáselo vos.
          </DialogDescription>
        </DialogHeader>
        <RecoveryLinkBody orgId={orgId} member={member} name={name} />
      </DialogContent>
    </Dialog>
  )
}

/** Vive dentro del diálogo: al cerrarlo se desmonta y el link no reaparece. */
function RecoveryLinkBody({ orgId, member, name }: { orgId: string; member: Member; name: string }) {
  const [state, formAction, pending] = React.useActionState<RecoveryState, FormData>(
    createRecoveryLink,
    null
  )

  if (state?.link) return <GeneratedRecoveryLink link={state.link} name={name} />

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="user" value={member.user_id} />
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
          Generar link
        </Button>
      </DialogFooter>
    </form>
  )
}

function GeneratedRecoveryLink({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = React.useState(false)
  const message = `¡Hola! Te paso el link para elegir una contraseña nueva en Operon Reservas. Sirve una sola vez y vence en una hora: ${link}`

  return (
    <div className="rounded-xl border border-primary/30 bg-accent/60 p-4">
      <p className="label-mono text-accent-foreground">
        Link para {name} · copialo ahora, no se vuelve a mostrar
      </p>
      <code className="mt-2 block truncate rounded-lg border bg-background px-3 py-2 font-mono text-xs">
        {link}
      </code>
      <div className="mt-3 flex flex-wrap gap-2">
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
      <p className="mt-3 text-xs text-muted-foreground">
        No lo abras vos: entrarías a su cuenta y el link se gasta.
      </p>
    </div>
  )
}
