"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { saveZoneFeedback } from "@/app/(panel)/tu-zona/actions"
import { INTERESTS, type InterestId } from "@/lib/zone-month/content"

/** Copia un mensaje ya completado con el nombre y el link del complejo. */
export function CopyMessage({ text, label = "Copiar mensaje" }: { text: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast.error("No se pudo copiar. Seleccioná el texto y copialo a mano.")
      return
    }
    setCopied(true)
    toast.success("Mensaje copiado. Pegalo en WhatsApp o Instagram.")
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring">
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copiado" : label}
    </button>
  )
}

/** Tilde "Ya lo hice" de cada idea. Se guarda por complejo y mes. */
export function IdeaDone({ month, id, initialDone }: { month: string; id: string; initialDone: string[] }) {
  const [done, setDone] = React.useState(initialDone.includes(id))
  const [pending, startTransition] = React.useTransition()
  function toggle() {
    const next = !done
    setDone(next)
    startTransition(async () => {
      const res = await saveZoneFeedback(month, { toggle: { id, done: next } })
      if (!res.ok) { setDone(!next); toast.error(res.error) }
    })
  }
  return (
    <button type="button" onClick={toggle} disabled={pending} aria-pressed={done}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60",
        done ? "border-success/40 bg-success/15 text-success" : "hover:bg-muted",
      )}>
      <Check className={cn("size-4", done ? "opacity-100" : "opacity-30")} />{done ? "Hecho" : "Marcar como hecho"}
    </button>
  )
}

/** La pregunta del cierre, ahora con respuesta: enfoca la próxima edición. */
export function InterestPicker({ month, initial }: { month: string; initial: string[] }) {
  const [selected, setSelected] = React.useState<string[]>(initial)
  const [pending, startTransition] = React.useTransition()
  function toggle(id: InterestId) {
    const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]
    setSelected(next)
    startTransition(async () => {
      const res = await saveZoneFeedback(month, { interests: next })
      if (!res.ok) { setSelected(selected); toast.error(res.error) }
      else toast.success("Listo. Lo tenemos en cuenta para la próxima edición.")
    })
  }
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Temas para profundizar">
      {(Object.keys(INTERESTS) as InterestId[]).map(id => {
        const on = selected.includes(id)
        return (
          <button key={id} type="button" onClick={() => toggle(id)} disabled={pending} aria-pressed={on}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60",
              on ? "border-primary-foreground bg-primary-foreground text-primary" : "border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10",
            )}>
            {on && <Check className="size-4" />}{INTERESTS[id]}
          </button>
        )
      })}
    </div>
  )
}
