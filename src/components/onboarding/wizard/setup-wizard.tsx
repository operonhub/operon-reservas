"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, LoaderCircle, LogOut } from "lucide-react"
import { logout } from "@/app/login/actions"
import { checkSlug, finishSetup, saveDraft } from "@/app/bienvenida/actions"
import { OperonArc } from "@/components/brand/operon-arc"
import { Button } from "@/components/ui/button"
import { ENTER_SIDE } from "@/lib/motion"
import {
  LAST_STEP,
  SETUP_STEPS,
  firstIncompleteStep,
  stepError,
  type SetupDraft,
} from "@/lib/onboarding/setup-draft"
import { isValidSlug, slugify } from "@/lib/slug"
import { cn } from "@/lib/utils"
import {
  StepDetails,
  StepLink,
  StepName,
  StepPrices,
  StepSummary,
  StepUnits,
  type SlugStatus,
  type StepProps,
} from "./steps"

const STEP_VIEWS: React.ComponentType<StepProps>[] = [
  StepName,
  StepLink,
  StepDetails,
  StepUnits,
  StepPrices,
  StepSummary,
]

export function SetupWizard({
  initialDraft,
  firstName,
  publicBase,
}: {
  initialDraft: SetupDraft
  firstName: string
  publicBase: string
}) {
  const searchParams = useSearchParams()
  const [draft, setDraft] = React.useState(initialDraft)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [slugCheck, setSlugCheck] = React.useState<{ slug: string; available: boolean | null } | null>(null)

  // El paso vive en la URL (?paso=N) para que Atrás del navegador funcione y un
  // refresco no pierda el lugar, pero nunca deja pasar de un paso incompleto.
  // Sin ?paso, retoma donde quedó el borrador.
  const reachable = firstIncompleteStep(draft)
  const requested = Number.parseInt(searchParams.get("paso") ?? "", 10)
  const step = Number.isNaN(requested) ? reachable : Math.max(0, Math.min(requested - 1, reachable))

  const slugStatus: SlugStatus = !draft.slug
    ? "idle"
    : !isValidSlug(draft.slug)
      ? "invalid"
      : slugCheck?.slug !== draft.slug
        ? "checking"
        : slugCheck.available === null
          ? "unknown"
          : slugCheck.available
            ? "available"
            : "taken"

  React.useEffect(() => {
    if (step !== 1 || !isValidSlug(draft.slug)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const { available } = await checkSlug(draft.slug)
      if (!cancelled) setSlugCheck({ slug: draft.slug, available })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft.slug, step])

  const update = React.useCallback((patch: Partial<SetupDraft>) => {
    setError(null)
    setDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.name !== undefined && !current.slugEdited) next.slug = slugify(patch.name)
      return next
    })
  }, [])

  const goTo = React.useCallback((target: number) => {
    setError(null)
    window.history.pushState(null, "", `?paso=${target + 1}`)
    window.scrollTo({ top: 0 })
  }, [])

  async function onNext() {
    const message = stepError(step, draft)
    if (message) return setError(message)
    if (step === 1 && slugStatus === "taken") return setError("Ese link ya está en uso. Probá con otro.")

    setPending(true)
    const { ok } = await saveDraft(draft)
    setPending(false)
    if (!ok) toast.warning("No pudimos guardar el avance, pero podés seguir.")
    goTo(step + 1)
  }

  async function onFinish() {
    setPending(true)
    // Si sale bien, la acción redirige al panel y esto no vuelve.
    const result = await finishSetup(draft)
    setPending(false)
    if (!result) return
    if (result.step === 1) setSlugCheck({ slug: draft.slug, available: false })
    if (result.step !== undefined && result.step !== step) goTo(result.step)
    setError(result.error)
  }

  const StepView = STEP_VIEWS[step]
  const progress = ((step + 1) / SETUP_STEPS.length) * 100

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <OperonArc className="inset-0" size={560} thickness={70} corner="bottom-right" />

      <header className="relative flex items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <span className="font-heading text-base font-semibold tracking-tight">
          Operon <span className="label-mono ml-1 text-muted-foreground">Reservas</span>
        </span>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut /> Salir
          </Button>
        </form>
      </header>

      <div className="relative px-4 sm:px-8">
        <div className="mx-auto max-w-xl">
          <p className="label-mono text-primary">
            Paso {step + 1} de {SETUP_STEPS.length} · {SETUP_STEPS[step].label}
          </p>
          <div
            role="progressbar"
            aria-label="Avance de la configuración"
            aria-valuemin={1}
            aria-valuemax={SETUP_STEPS.length}
            aria-valuenow={step + 1}
            className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <form
        noValidate
        className="relative flex flex-1 flex-col px-4 pb-8 sm:px-8"
        onSubmit={(event) => {
          event.preventDefault()
          if (pending) return
          if (step === LAST_STEP) void onFinish()
          else void onNext()
        }}
      >
        <div key={step} className={cn(ENTER_SIDE, "mx-auto w-full max-w-xl flex-1 pt-10 sm:pt-14")}>
          <StepView
            draft={draft}
            update={update}
            goTo={goTo}
            slugStatus={slugStatus}
            firstName={firstName}
            publicBase={publicBase}
          />
          {error && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <div className="mx-auto mt-10 flex w-full max-w-xl items-center justify-between gap-3">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => goTo(step - 1)} disabled={pending}>
              <ArrowLeft /> Atrás
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" size="lg" disabled={pending} className="h-11 min-w-40 px-5 text-base">
            {pending && <LoaderCircle className="animate-spin" />}
            {step === LAST_STEP ? (pending ? "Creando tu complejo…" : "Crear mi complejo") : "Siguiente"}
            {!pending && <ArrowRight />}
          </Button>
        </div>
      </form>
    </main>
  )
}
