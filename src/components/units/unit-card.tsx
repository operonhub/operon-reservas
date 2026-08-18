import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { unitPhotoUrl } from "@/lib/storage"
import { AMENITIES, type AmenityKey } from "@/lib/amenities"
import { ENTER_UP, stagger } from "@/lib/motion"
import { formatDay } from "@/lib/format"
import { UnitDialog } from "@/components/units/unit-dialog"
import { UnitActiveToggle } from "@/components/units/unit-active-toggle"
import { OperonMarkTinta } from "@/components/brand/operon-mark"
import { Users, CalendarDays, Ban, CircleCheck, Moon } from "lucide-react"

export type UnitCardData = {
  id: string
  name: string
  description: string | null
  capacity: number
  isActive: boolean
  photoPath: string | null
  amenities: AmenityKey[]
  propertyName?: string
  current: { kind: string; until: string; label: string | null } | null
  nextArrival: string | null
  occupancyPct: number
  horizonDays: number
}

/** Cuántos íconos de servicio entran sin apretar la tarjeta. */
const VISIBLE_AMENITIES = 6

export function UnitCard({
  unit,
  properties,
  organizationId,
  index,
}: {
  unit: UnitCardData
  properties: { id: string; name: string }[]
  organizationId: string
  index: number
}) {
  const photo = unitPhotoUrl(unit.photoPath)
  const shown = unit.amenities.slice(0, VISIBLE_AMENITIES)
  const rest = unit.amenities.length - shown.length

  return (
    <article
      className={cn(
        ENTER_UP,
        "group flex flex-col overflow-hidden rounded-2xl border bg-card transition-all",
        "hover:border-primary/40 hover:shadow-lg",
        !unit.isActive && "opacity-75"
      )}
      style={stagger(index, 70)}
    >
      {/* ---------- Foto + overlay ---------- */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {photo ? (
          <Image
            src={photo}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className={cn(
              "object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none",
              // Una unidad dada de baja se distingue sin desaparecer.
              !unit.isActive && "grayscale"
            )}
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <OperonMarkTinta className="h-12 w-9 opacity-10" />
          </div>
        )}

        {/* Degradado para que el texto se lea sobre cualquier foto. */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-semibold tracking-tight text-white">
              {unit.name}
            </h2>
            <p className="label-mono mt-1 flex items-center gap-1.5 text-white/80">
              <Users className="size-3" />
              {unit.capacity} personas
              {unit.propertyName && ` · ${unit.propertyName}`}
            </p>
          </div>
          <StatusChip unit={unit} />
        </div>
      </div>

      {/* ---------- Servicios ---------- */}
      <div className="flex min-h-[52px] flex-wrap items-center gap-1.5 border-b px-4 py-3">
        {shown.length === 0 ? (
          <span className="label-mono text-muted-foreground">Sin servicios cargados</span>
        ) : (
          <>
            {shown.map((key) => {
              const { label, icon: Icon } = AMENITIES[key]
              return (
                <span
                  key={key}
                  title={label}
                  className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground"
                >
                  <Icon className="size-3.5" />
                </span>
              )
            })}
            {rest > 0 && (
              <span className="label-mono text-muted-foreground">+{rest}</span>
            )}
          </>
        )}
      </div>

      {/* ---------- Datos operativos ---------- */}
      <div className="grid grid-cols-2 gap-3 px-4 py-3 text-sm">
        <div>
          <p className="label-mono text-muted-foreground">Próxima llegada</p>
          <p className="mt-0.5 font-mono tabular-nums">
            {unit.nextArrival ? formatDay(unit.nextArrival) : "—"}
          </p>
        </div>
        <div>
          <p className="label-mono text-muted-foreground">
            Ocupación · {unit.horizonDays}d
          </p>
          <p className="mt-0.5 font-mono tabular-nums">{unit.occupancyPct}%</p>
        </div>
      </div>

      {/* ---------- Acciones ---------- */}
      <div className="mt-auto flex items-center gap-1 border-t px-3 py-2.5">
        <UnitDialog
          mode="edit"
          unit={{
            id: unit.id,
            name: unit.name,
            description: unit.description,
            capacity: unit.capacity,
            is_active: unit.isActive,
            photo_path: unit.photoPath,
            amenities: unit.amenities,
          }}
          properties={properties}
          organizationId={organizationId}
          triggerLabel="Editar"
          triggerVariant="ghost"
          triggerSize="sm"
        />
        <Link
          href="/calendario"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CalendarDays className="size-3.5" /> Calendario
        </Link>
        <div className="ml-auto">
          <UnitActiveToggle id={unit.id} isActive={unit.isActive} />
        </div>
      </div>
    </article>
  )
}

/** Qué está pasando con la unidad AHORA — el dato más consultado. */
function StatusChip({ unit }: { unit: UnitCardData }) {
  if (!unit.isActive) {
    return (
      <Chip className="bg-background/90 text-muted-foreground">
        <Ban className="size-3" /> Inactiva
      </Chip>
    )
  }
  if (unit.current?.kind === "block") {
    return (
      <Chip className="bg-warning text-warning-foreground">
        <Ban className="size-3" /> {unit.current.label || "Bloqueada"}
      </Chip>
    )
  }
  if (unit.current) {
    return (
      <Chip className="bg-primary text-primary-foreground">
        <Moon className="size-3" /> Hasta {formatDay(unit.current.until)}
      </Chip>
    )
  }
  return (
    <Chip className="bg-success text-success-foreground">
      <CircleCheck className="size-3" /> Libre hoy
    </Chip>
  )
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "label-mono flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 whitespace-nowrap",
        className
      )}
    >
      {children}
    </span>
  )
}
