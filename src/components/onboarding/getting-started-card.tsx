"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowRight, Check, Copy, X } from "lucide-react"
import { dismissChecklist } from "@/app/(panel)/onboarding-actions"
import { useCopyPublicLink } from "@/components/onboarding/share-link"
import { Button } from "@/components/ui/button"
import type { Checklist } from "@/lib/onboarding/checklist"
import { ENTER_UP } from "@/lib/motion"
import { cn } from "@/lib/utils"

function ProgressRing({ value, total }: { value: number; total: number }) {
  const radius = 20
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative size-14 shrink-0" aria-hidden>
      <svg viewBox="0 0 48 48" className="size-full -rotate-90">
        <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / total)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold tabular-nums">
        {value}/{total}
      </span>
    </div>
  )
}

export function GettingStartedCard({
  checklist,
  canDismiss,
  publicUrl,
}: {
  checklist: Checklist
  canDismiss: boolean
  publicUrl: string
}) {
  const [hidden, setHidden] = React.useState(false)
  const { copied, copy } = useCopyPublicLink(publicUrl)
  const [sharedNow, setSharedNow] = React.useState(false)

  if (hidden) return null

  // El link copiado se tilda al instante; la base se entera por detrás.
  const items = checklist.items.map((item) =>
    item.key === "link" && sharedNow ? { ...item, done: true } : item
  )
  const done = items.filter((item) => item.done).length
  const complete = done === checklist.total

  async function onDismiss() {
    setHidden(true)
    const result = await dismissChecklist()
    if (result.error) {
      setHidden(false)
      toast.error(result.error)
    }
  }

  return (
    <section
      data-tour="primeros-pasos"
      aria-labelledby="primeros-pasos-title"
      className={cn(ENTER_UP, "mt-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-6")}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ProgressRing value={done} total={checklist.total} />
          <div>
            <p className="label-mono text-primary">Primeros pasos</p>
            <h2 id="primeros-pasos-title" className="mt-1 text-lg leading-snug font-semibold">
              {complete ? "¡Tenés todo andando!" : "Dejá tu complejo listo para recibir reservas"}
            </h2>
          </div>
        </div>
        {complete && canDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss} className="text-muted-foreground">
            <X /> Ocultar
          </Button>
        )}
      </div>

      <ol className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.key}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3.5 transition-colors",
              item.done ? "border-transparent bg-muted/50" : "bg-background"
            )}
          >
            {/* aria-label y no `sr-only`: un sr-only se escapa del contenedor con
                scroll del panel y puede estirar la página. */}
            <span
              role="img"
              aria-label={item.done ? "Hecho" : "Pendiente"}
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                item.done ? "border-success bg-success text-success-foreground" : "border-border"
              )}
            >
              {item.done && <Check className="size-3" strokeWidth={3} aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  item.done && "text-muted-foreground line-through decoration-muted-foreground/40"
                )}
              >
                {item.title}
              </p>
              {!item.done && (
                <>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                  {item.key === "link" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (await copy()) setSharedNow(true)
                      }}
                      className="label-mono mt-2 inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      Copiar link
                    </button>
                  ) : (
                    item.href && (
                      <Link
                        href={item.href}
                        className="label-mono mt-2 inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {item.cta} <ArrowRight className="size-3" />
                      </Link>
                    )
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
