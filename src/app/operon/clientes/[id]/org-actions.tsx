"use client"

import * as React from "react"
import { toast } from "sonner"
import { LoaderCircle, PauseCircle, PlayCircle } from "lucide-react"
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
import { reactivateOrg, suspendOrg, type ActionState } from "./actions"

/**
 * Suspender o reactivar un complejo. El diálogo explica qué pasa antes de
 * confirmar: es la acción con más impacto del panel.
 */
export function OrgStatusAction({
  orgId,
  orgName,
  suspended,
}: {
  orgId: string
  orgName: string
  suspended: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const run = suspended ? reactivateOrg : suspendOrg

  // El diálogo se cierra desde la acción, no desde un efecto.
  const [state, formAction, pending] = React.useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await run(prev, formData)
      if (result?.ok) {
        setOpen(false)
        toast.success(suspended ? `${orgName} está activo de nuevo.` : `${orgName} quedó suspendido.`)
      }
      return result
    },
    null
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          buttonVariants({ variant: suspended ? "default" : "outline", size: "sm" }),
          !suspended && "text-destructive hover:text-destructive"
        )}
      >
        {suspended ? <PlayCircle /> : <PauseCircle />}
        {suspended ? "Reactivar" : "Suspender"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{suspended ? `Reactivar ${orgName}` : `Suspender ${orgName}`}</DialogTitle>
          <DialogDescription>
            {suspended
              ? "El equipo vuelve a entrar a su panel y la página de reservas acepta reservas nuevas otra vez. Los calendarios de Airbnb y Booking se ponen al día en la próxima sincronización."
              : "El equipo no va a poder entrar a su panel y la página de reservas deja de aceptar reservas nuevas. Las reservas y los pagos que ya estaban en curso siguen funcionando, y no se borra nada."}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="grid gap-4">
          <input type="hidden" name="org" value={orgId} />
          <div className="grid gap-1.5">
            <Label htmlFor="reason">
              Motivo {suspended && <span className="font-normal text-muted-foreground">(opcional)</span>}
            </Label>
            <Textarea
              id="reason"
              name="reason"
              rows={3}
              maxLength={500}
              required={!suspended}
              minLength={suspended ? undefined : 3}
              placeholder={suspended ? "Pagó la cuota de octubre" : "No pagó la cuota de septiembre"}
            />
            <p className="text-xs text-muted-foreground">
              Queda en el registro de acciones. El cliente no lo ve.
            </p>
          </div>

          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" variant={suspended ? "default" : "destructive"} disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" />}
              {suspended ? "Reactivar" : "Suspender"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
