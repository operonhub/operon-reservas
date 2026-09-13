"use client"

import * as React from "react"
import { Check, LoaderCircle, Plus, Trash2, TriangleAlert, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CURRENCIES } from "@/lib/currencies"
import { formatCurrency } from "@/lib/format"
import {
  MAX_UNITS,
  cleanPriceInput,
  emptyUnit,
  formatPriceInput,
  parsePrice,
  type SetupDraft,
  type SetupUnit,
} from "@/lib/onboarding/setup-draft"
import { toSlugInput } from "@/lib/slug"
import { cn } from "@/lib/utils"

export type SlugStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown"

export type StepProps = {
  draft: SetupDraft
  update: (patch: Partial<SetupDraft>) => void
  goTo: (step: number) => void
  slugStatus: SlugStatus
  firstName: string
  /** Origen del sitio, para mostrar el link público tal cual va a quedar. */
  publicBase: string
}

const BIG_INPUT = "h-12 px-3.5 text-base md:text-base"

function Question({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <div>
      {eyebrow && <p className="label-mono text-muted-foreground">{eyebrow}</p>}
      <h1 className="mt-1.5 text-3xl leading-tight font-semibold sm:text-4xl">{title}</h1>
      {children && <p className="mt-2.5 text-base text-muted-foreground">{children}</p>}
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

const host = (publicBase: string) => publicBase.replace(/^https?:\/\//, "")

/* ------------------------------- 1. Nombre ------------------------------- */

export function StepName({ draft, update, firstName }: StepProps) {
  return (
    <>
      <Question eyebrow={firstName ? `¡Hola, ${firstName}!` : "¡Hola!"} title="¿Cómo se llama tu complejo?">
        Es el nombre que van a ver tus huéspedes.
      </Question>
      <Input
        aria-label="Nombre del complejo"
        autoFocus
        autoComplete="organization"
        placeholder="Cabañas del Lago"
        maxLength={80}
        value={draft.name}
        onChange={(e) => update({ name: e.target.value })}
        className={cn(BIG_INPUT, "mt-8")}
      />
    </>
  )
}

/* -------------------------------- 2. Link -------------------------------- */

const SLUG_HINT: Record<Exclude<SlugStatus, "idle">, { text: string; tone: string; icon?: React.ReactNode }> = {
  checking: {
    text: "Revisando si está libre…",
    tone: "text-muted-foreground",
    icon: <LoaderCircle className="size-3.5 animate-spin" />,
  },
  available: { text: "¡Está libre!", tone: "text-success", icon: <Check className="size-3.5" /> },
  taken: {
    text: "Ese link ya está en uso. Probá con otro.",
    tone: "text-destructive",
    icon: <TriangleAlert className="size-3.5" />,
  },
  invalid: {
    text: "Usá entre 3 y 48 letras minúsculas, números o guiones.",
    tone: "text-destructive",
    icon: <TriangleAlert className="size-3.5" />,
  },
  unknown: { text: "No pudimos revisarlo ahora; lo confirmamos al final.", tone: "text-muted-foreground" },
}

export function StepLink({ draft, update, slugStatus, publicBase }: StepProps) {
  const hint = slugStatus === "idle" ? null : SLUG_HINT[slugStatus]
  const bad = slugStatus === "taken" || slugStatus === "invalid"

  return (
    <>
      <Question title="Tu link de reservas">
        Lo compartís por WhatsApp o Instagram para que te reserven directo. Lo armamos con el nombre;
        podés cambiarlo.
      </Question>

      <div
        className={cn(
          "mt-8 flex h-12 items-center overflow-hidden rounded-lg border border-input bg-card transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          bad && "border-destructive/60"
        )}
      >
        <span className="flex h-full max-w-[55%] shrink-0 items-center truncate border-r bg-muted px-3 font-mono text-xs text-muted-foreground sm:text-sm">
          {host(publicBase)}/reservar/
        </span>
        <input
          aria-label="Link de reservas"
          aria-invalid={bad}
          autoFocus
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          value={draft.slug}
          onChange={(e) =>
            update({
              slug: toSlugInput(e.target.value),
              slugEdited: true,
            })
          }
          className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none sm:text-base"
        />
      </div>

      <p aria-live="polite" className={cn("mt-2 flex min-h-5 items-center gap-1.5 text-sm", hint?.tone)}>
        {hint?.icon}
        {hint?.text}
      </p>
    </>
  )
}

/* ------------------------------ 3. Detalles ------------------------------ */

export function StepDetails({ draft, update }: StepProps) {
  return (
    <>
      <Question title="Algunos detalles">
        Podés dejarlo así y cambiarlo después en Configuración.
      </Question>

      <div className="mt-8 grid gap-5">
        <Field label="Ciudad o localidad (opcional)" htmlFor="city">
          <Input
            id="city"
            autoFocus
            placeholder="Villa Traful, Neuquén"
            maxLength={80}
            value={draft.city}
            onChange={(e) => update({ city: e.target.value })}
            className={BIG_INPUT}
          />
        </Field>

        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Moneda en la que cobrás</legend>
          {/* Con dos opciones, un botón por moneda se decide de un toque; un
              desplegable escondía la elección detrás de un clic más. */}
          <div className="grid grid-cols-2 gap-3">
            {CURRENCIES.map((c) => {
              const selected = draft.currency === c.code
              return (
                <button
                  key={c.code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ currency: c.code })}
                  className={cn(
                    "flex h-12 items-center justify-between gap-2 rounded-lg border px-3.5 text-left text-base transition-colors",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    selected
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-input hover:bg-muted"
                  )}
                >
                  <span className="truncate font-medium">{c.label}</span>
                  <span className="label-mono shrink-0 text-muted-foreground">{c.code}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Check-in desde" htmlFor="checkin">
            <Input
              id="checkin"
              type="time"
              value={draft.checkinTime}
              onChange={(e) => update({ checkinTime: e.target.value })}
              className={BIG_INPUT}
            />
          </Field>
          <Field label="Check-out hasta" htmlFor="checkout">
            <Input
              id="checkout"
              type="time"
              value={draft.checkoutTime}
              onChange={(e) => update({ checkoutTime: e.target.value })}
              className={BIG_INPUT}
            />
          </Field>
        </div>
      </div>
    </>
  )
}

/* ------------------------------ 4. Unidades ------------------------------ */

export function StepUnits({ draft, update }: StepProps) {
  const setUnit = (index: number, patch: Partial<SetupUnit>) =>
    update({ units: draft.units.map((u, i) => (i === index ? { ...u, ...patch } : u)) })

  return (
    <>
      <Question title="¿Qué unidades alquilás?">
        Cabañas, departamentos, habitaciones… Cargá cada una con cuántas personas entran.
      </Question>

      <div className="mt-8 grid gap-3">
        <div className="grid grid-cols-[1fr_5.5rem_2.5rem] gap-3 px-1" aria-hidden>
          <span className="label-mono text-muted-foreground">Nombre</span>
          <span className="label-mono text-muted-foreground">Personas</span>
        </div>

        {draft.units.map((unit, index) => (
          <div key={index} className="grid grid-cols-[1fr_5.5rem_2.5rem] items-center gap-3">
            <Input
              aria-label={`Nombre de la unidad ${index + 1}`}
              autoFocus={index === 0 ? !unit.name : index === draft.units.length - 1}
              placeholder={`Cabaña ${index + 1}`}
              maxLength={60}
              value={unit.name}
              onChange={(e) => setUnit(index, { name: e.target.value })}
              className="h-11 px-3 text-base md:text-base"
            />
            <Input
              aria-label={`Personas en la unidad ${index + 1}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={unit.capacity}
              onChange={(e) => setUnit(index, { capacity: e.target.value })}
              className="h-11 px-3 text-base tabular-nums md:text-base"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar la unidad ${index + 1}`}
              disabled={draft.units.length === 1}
              onClick={() => update({ units: draft.units.filter((_, i) => i !== index) })}
            >
              <Trash2 />
            </Button>
          </div>
        ))}

        {draft.units.length < MAX_UNITS && (
          <Button
            type="button"
            variant="outline"
            className="h-10 justify-self-start"
            onClick={() => update({ units: [...draft.units, emptyUnit()] })}
          >
            <Plus /> Agregar otra unidad
          </Button>
        )}
      </div>
    </>
  )
}

/* ------------------------------- 5. Precios ------------------------------ */

export function StepPrices({ draft, update }: StepProps) {
  return (
    <>
      <Question title="¿Cuánto cobrás por noche?">
        Es el precio base de cada unidad. Temporadas, fines de semana y promociones las cargás después
        en Tarifas.
      </Question>

      <div className="mt-8 grid gap-3">
        {draft.units.map((unit, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 rounded-xl border bg-card p-3 pl-4"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{unit.name.trim()}</p>
              <p className="label-mono mt-1 flex items-center gap-1 text-muted-foreground">
                <Users className="size-3" /> {unit.capacity} personas
              </p>
            </div>
            <div className="flex h-11 w-40 shrink-0 items-stretch overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:w-48">
              <span className="label-mono flex items-center border-r bg-muted px-2.5 text-muted-foreground">
                {draft.currency}
              </span>
              <input
                aria-label={`Precio por noche de ${unit.name.trim()}`}
                autoFocus={index === 0}
                inputMode="decimal"
                placeholder="85.000"
                value={formatPriceInput(unit.price)}
                onChange={(e) => {
                  const price = cleanPriceInput(e.target.value)
                  update({ units: draft.units.map((u, i) => (i === index ? { ...u, price } : u)) })
                }}
                className="min-w-0 flex-1 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none"
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Si cobrás con centavos, usá coma: 85.000,50.</p>
    </>
  )
}

/* ------------------------------- 6. Resumen ------------------------------ */

function SummaryCard({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="label-mono text-muted-foreground">{title}</p>
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onEdit}>
          Editar
        </Button>
      </div>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

export function StepSummary({ draft, goTo, publicBase }: StepProps) {
  const units = draft.units
  return (
    <>
      <Question title="Todo listo">
        Revisá que esté bien. Apenas lo crees, ya podés cargar reservas y compartir tu link.
      </Question>

      <div className="mt-8 grid gap-3">
        <SummaryCard title="Tu complejo" onEdit={() => goTo(0)}>
          <p className="font-heading text-lg font-semibold tracking-tight">{draft.name.trim()}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {host(publicBase)}/reservar/{draft.slug}
          </p>
        </SummaryCard>

        <SummaryCard title="Detalles" onEdit={() => goTo(2)}>
          <p className="text-sm">
            {[draft.city.trim(), draft.currency, `Check-in ${draft.checkinTime} · Check-out ${draft.checkoutTime}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </SummaryCard>

        <SummaryCard
          title={`${units.length} ${units.length === 1 ? "unidad" : "unidades"}`}
          onEdit={() => goTo(3)}
        >
          <ul className="divide-y">
            {units.map((unit, index) => (
              <li key={index} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {unit.name.trim()} <span className="text-muted-foreground">· {unit.capacity} personas</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  {formatCurrency(parsePrice(unit.price), draft.currency)}
                  <span className="text-muted-foreground"> /noche</span>
                </span>
              </li>
            ))}
          </ul>
        </SummaryCard>
      </div>
    </>
  )
}
