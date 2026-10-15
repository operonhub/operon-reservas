const now = "2026-09-08T12:00:00.000Z"

export const DEMO_CONTEXT = {
  userId: "demo-user",
  email: "demo@operon.app",
  fullName: "Lucía Herrera",
  organizationId: "demo-org",
  organizationName: "Refugio Alto Cielo",
  organizationSlug: "refugio-alto-cielo",
  role: "owner",
  // En la demo el tour se recuerda por visitante en su navegador, no en la base.
  tourCompleted: false,
  checklistDismissed: false,
  isPlatformAdmin: false,
  // La demo muestra Tu zona si el interruptor general está prendido.
  zoneMonthEnabled: true,
}

/** El nombre de la cookie que lleva lo que cada visitante creó en la demo. */
export const DEMO_STATE_COOKIE = "operon_demo_state"

// Techo de reservas creadas por visitante. Antes las altas se acumulaban en
// el módulo y las veía el visitante siguiente (auditoría M-05); ahora cada
// uno tiene lo suyo en su cookie, y este tope evita que la cookie crezca sin
// control.
const MAX_DEMO_CREATED = 6

// ------------------------------------------------------------------
// Datos base: inmutables y compartidos. Nadie los modifica en runtime;
// cada lectura arma copias frescas y encima aplica el estado del visitante.
// ------------------------------------------------------------------

type BaseUnit = {
  id: string
  property_id: string
  name: string
  capacity: number
  is_active: boolean
  position: number
  description: string | null
  photo_path: string
  amenities: string[]
  airbnb_ical_url: string | null
  booking_ical_url: string | null
  ical_token: string
  properties: { name: string }
}

const BASE_UNITS: readonly BaseUnit[] = [
  { id: "unit-1", property_id: "property-1", name: "Cabaña del Bosque", capacity: 4, is_active: true, position: 1, description: "Dos dormitorios, galería y vista al monte.", photo_path: "https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=1400&q=85", amenities: ["Parrilla", "Wi-Fi", "Cocina equipada"], airbnb_ical_url: null, booking_ical_url: null, ical_token: "demo", properties: { name: "Refugio Alto Cielo" } },
  { id: "unit-2", property_id: "property-1", name: "Suite Mirador", capacity: 2, is_active: true, position: 2, description: "Suite íntima con terraza privada.", photo_path: "https://images.unsplash.com/photo-1601918774946-25832a4be0d6?auto=format&fit=crop&w=1400&q=85", amenities: ["Desayuno", "Aire acondicionado", "Deck"], airbnb_ical_url: null, booking_ical_url: null, ical_token: "demo", properties: { name: "Refugio Alto Cielo" } },
  { id: "unit-3", property_id: "property-1", name: "Casa del Arroyo", capacity: 6, is_active: true, position: 3, description: "Espacio amplio para familias, junto al arroyo.", photo_path: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=85", amenities: ["Pileta", "Lavadero", "Cochera"], airbnb_ical_url: null, booking_ical_url: null, ical_token: "demo", properties: { name: "Refugio Alto Cielo" } },
]

type DemoReservation = {
  id: string
  unit_id: string
  code: string
  check_in: string
  check_out: string
  checked_in_at: string | null
  checked_out_at: string | null
  guests_count: number
  status: string
  source: string
  total_amount: number
  deposit_amount: number
  currency: string
  notes: string | null
  created_at: string
  updated_at: string
  guests: { id: string; full_name: string; email: string | null; phone: string | null }
  units: { name: string; capacity: number }
  payments: { amount: number; status: string; kind: string; paid_at: string | null }[]
}

const BASE_RESERVATIONS: readonly DemoReservation[] = [
  { id: "res-1", unit_id: "unit-1", code: "AC-4821", check_in: "2026-09-12", check_out: "2026-09-16", checked_in_at: null, checked_out_at: null, guests_count: 3, status: "pending_payment", source: "direct", total_amount: 592000, deposit_amount: 296000, currency: "ARS", notes: "Llega cerca de las 18 h.", created_at: now, updated_at: now, guests: { id: "guest-1", full_name: "Martina Roldán", email: "martina@ejemplo.com", phone: "+5493515550101" }, units: { name: "Cabaña del Bosque", capacity: 4 }, payments: [{ amount: 296000, status: "paid", kind: "deposit", paid_at: now }] },
  { id: "res-2", unit_id: "unit-2", code: "AC-4820", check_in: "2026-09-10", check_out: "2026-09-13", checked_in_at: null, checked_out_at: null, guests_count: 2, status: "confirmed", source: "whatsapp", total_amount: 336000, deposit_amount: 168000, currency: "ARS", notes: null, created_at: now, updated_at: now, guests: { id: "guest-2", full_name: "Tomás Ledesma", email: "tomas@ejemplo.com", phone: "+5493515550102" }, units: { name: "Suite Mirador", capacity: 2 }, payments: [{ amount: 336000, status: "paid", kind: "balance", paid_at: now }] },
  { id: "res-3", unit_id: "unit-3", code: "AC-4818", check_in: "2026-09-14", check_out: "2026-09-18", checked_in_at: null, checked_out_at: null, guests_count: 5, status: "pending", source: "booking", total_amount: 780000, deposit_amount: 390000, currency: "ARS", notes: null, created_at: now, updated_at: now, guests: { id: "guest-3", full_name: "Paula Méndez", email: "paula@ejemplo.com", phone: "+5493515550103" }, units: { name: "Casa del Arroyo", capacity: 6 }, payments: [] },
]

const BASE_OCCUPANCY = [
  { id: "occ-1", unit_id: "unit-1", during: "[2026-09-12,2026-09-16)", kind: "reservation", block_reason: null, external_source: null, reservationId: "res-1" },
  { id: "occ-2", unit_id: "unit-2", during: "[2026-09-10,2026-09-13)", kind: "reservation", block_reason: null, external_source: null, reservationId: "res-2" },
  { id: "occ-3", unit_id: "unit-3", during: "[2026-09-14,2026-09-18)", kind: "reservation", block_reason: null, external_source: null, reservationId: "res-3" },
  // Una fecha que llegó del calendario de Booking: solo trae las fechas, sin huésped.
  { id: "occ-4", unit_id: "unit-2", during: "[2026-09-20,2026-09-23)", kind: "block", block_reason: null, external_source: "booking", reservationId: null },
] as const

const BASE_PROPERTIES = [{ id: "property-1", name: "Refugio Alto Cielo", slug: "refugio-alto-cielo", city: "San Javier, Córdoba", description: "Tres espacios para descansar entre sierras.", currency: "ARS", checkin_time: "14:00", checkout_time: "10:00", deposit_pct: 50, whatsapp: null, phone: null, email: null, address: null, created_at: now }]
const BASE_RATES = BASE_UNITS.map((unit, index) => ({ id: `rate-${index}`, unit_id: unit.id, kind: "base", label: "Tarifa base", price_per_night: [148000, 112000, 195000][index], discount_pct: null, weekdays: null, min_guests: null, max_guests: null, min_nights: null, min_nights_rule: null, priority: 0, start_date: null, end_date: null, is_active: true, currency: "ARS" }))

// ------------------------------------------------------------------
// Estado por visitante (viaja en la cookie DEMO_STATE_COOKIE)
// ------------------------------------------------------------------

export type DemoUnitPatch = {
  name?: string
  description?: string | null
  capacity?: number
  is_active?: boolean
  amenities?: string[]
}

export type DemoCreatedReservation = {
  id: string
  code: string
  unit_id: string
  check_in: string
  check_out: string
  guests_count: number
  status: string
  notes: string | null
  guest: { full_name: string; email: string | null; phone: string | null }
  /** Solo si el visitante la editó: el total recalculado. */
  total_amount?: number
  deposit_amount?: number
}

/** Lo que el visitante cambió de una reserva de ejemplo (las que él cargó se cambian en su lugar). */
export type DemoReservationEdit = {
  unit_id: string
  check_in: string
  check_out: string
  guests_count: number
  notes: string | null
  guest: { full_name: string; email: string | null; phone: string | null }
  total_amount: number
  deposit_amount: number
}

export type DemoPropertyPatch = {
  name?: string
  description?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  currency?: string
  checkin_time?: string
  checkout_time?: string
  deposit_pct?: number
}

export type DemoMovementPatch = {
  checkedInAt?: string | null
  checkedOutAt?: string | null
}

export type DemoState = {
  /** Reservas que cargó este visitante, de la más nueva a la más vieja. */
  created: DemoCreatedReservation[]
  /** id de reserva (base o creada) → nuevo estado. */
  statuses: Record<string, string>
  /** id de unidad → cambios de este visitante. */
  units: Record<string, DemoUnitPatch>
  /** Cambios de configuración de la propiedad de este visitante. */
  property: DemoPropertyPatch
  /** Momentos reales de ingreso/salida por reserva. */
  movements: Record<string, DemoMovementPatch>
  /** id de reserva de ejemplo → lo que el visitante le editó. */
  edits: Record<string, DemoReservationEdit>
  /** ids de reservas (de ejemplo) que el visitante eliminó. */
  deleted: string[]
}

export const EMPTY_DEMO_STATE: DemoState = { created: [], statuses: {}, units: {}, property: {}, movements: {}, edits: {}, deleted: [] }

// Alcanza con las reservas de ejemplo que hay; el tope evita que la cookie crezca.
const MAX_DEMO_DELETED = 12

/** Lee el estado de la cookie. Cualquier cosa rara vuelve al estado vacío. */
export function parseDemoState(raw: string | undefined): DemoState {
  if (!raw) return EMPTY_DEMO_STATE
  try {
    const json = JSON.parse(
      typeof atob === "function" ? atob(raw) : Buffer.from(raw, "base64").toString("utf8")
    )
    return {
      created: Array.isArray(json.created) ? json.created.slice(0, MAX_DEMO_CREATED) : [],
      statuses: json.statuses && typeof json.statuses === "object" ? json.statuses : {},
      units: json.units && typeof json.units === "object" ? json.units : {},
      property: json.property && typeof json.property === "object" ? json.property : {},
      movements: json.movements && typeof json.movements === "object" ? json.movements : {},
      edits: json.edits && typeof json.edits === "object" && !Array.isArray(json.edits) ? json.edits : {},
      deleted: Array.isArray(json.deleted)
        ? json.deleted.filter((id: unknown) => typeof id === "string").slice(0, MAX_DEMO_DELETED)
        : [],
    }
  } catch {
    return EMPTY_DEMO_STATE
  }
}

export function serializeDemoState(state: DemoState): string {
  const json = JSON.stringify(state)
  return typeof btoa === "function" ? btoa(json) : Buffer.from(json, "utf8").toString("base64")
}

const TOTAL_PER_CREATED = 420000
const DEPOSIT_PER_CREATED = 210000

function reservationIds(state: DemoState): Set<string> {
  const gone = new Set(state.deleted)
  return new Set([...BASE_RESERVATIONS.map((r) => r.id), ...state.created.map((r) => r.id)].filter((id) => !gone.has(id)))
}

/** Estados que retienen las fechas (espejo de holds_inventory() en la base). */
const HOLDING = new Set(["pending", "pending_payment", "confirmed", "completed"])

/** Precio de una estadía en la demo: tarifa base de la unidad por noche; seña según la propiedad. */
export function demoStayPrice(state: DemoState, unitId: string, nights: number): { total: number; deposit: number } {
  const rate = BASE_RATES.find((r) => r.unit_id === unitId)
  const total = (rate?.price_per_night ?? 0) * Math.max(0, nights)
  const pct = state.property.deposit_pct ?? BASE_PROPERTIES[0].deposit_pct
  return { total, deposit: Math.round((total * pct) / 100) }
}

/**
 * Agrega una reserva manual al estado del visitante. Devuelve el estado
 * nuevo y el id, o null si la unidad no existe. Corta en MAX_DEMO_CREATED.
 */
export function applyDemoManualReservation(
  state: DemoState,
  input: { unitId: string; fullName: string; email: string | null; phone: string | null; checkIn: string; checkOut: string; guests: number; status: string; notes: string | null }
): { state: DemoState; id: string } | null {
  if (!BASE_UNITS.some((u) => u.id === input.unitId)) return null
  const seq = state.created.length + BASE_RESERVATIONS.length
  const id = `demo-${Date.now()}-${seq}`
  const created: DemoCreatedReservation = {
    id,
    code: `AC-${4830 + state.created.length}`,
    unit_id: input.unitId,
    check_in: input.checkIn,
    check_out: input.checkOut,
    guests_count: input.guests,
    status: input.status,
    notes: input.notes,
    guest: { full_name: input.fullName, email: input.email, phone: input.phone },
  }
  return {
    id,
    state: { ...state, created: [created, ...state.created].slice(0, MAX_DEMO_CREATED) },
  }
}

export type DemoUpdateInput = {
  unitId: string
  checkIn: string
  checkOut: string
  guests: number
  fullName: string
  email: string | null
  phone: string | null
  notes: string | null
}

export type DemoUpdateSummary = {
  changed: boolean
  code: string
  unitName: string
  total: number
  deposit: number
  paid: number
  balance: number
  currency: string
}

const nightsOf = (checkIn: string, checkOut: string) =>
  Math.round((Date.parse(checkOut + "T00:00:00Z") - Date.parse(checkIn + "T00:00:00Z")) / 86400000)

const RANGE = /\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)/

/**
 * Edita una reserva (de ejemplo o cargada por el visitante) con las mismas
 * reglas que la base: no cancelada, capacidad, fechas libres y total recalculado.
 */
export function applyDemoUpdate(
  state: DemoState,
  id: string,
  input: DemoUpdateInput
): { ok: true; state: DemoState; summary: DemoUpdateSummary } | { ok: false; error: string } {
  const current = buildReservations(state).find((r) => r.id === id)
  if (!current) return { ok: false, error: "No encontramos la reserva. Puede que ya la hayan eliminado." }
  if (current.status === "cancelled" || current.status === "expired") {
    return { ok: false, error: "Una reserva cancelada o expirada no se puede editar." }
  }
  const unit = BASE_UNITS.find((u) => u.id === input.unitId)
  if (!unit) return { ok: false, error: "La unidad no existe o está inactiva." }
  if (!input.fullName.trim()) return { ok: false, error: "El nombre del huésped es obligatorio." }
  if (!(input.guests >= 1)) return { ok: false, error: "La cantidad de huéspedes tiene que ser de al menos 1." }
  if (!input.checkIn || !input.checkOut || input.checkOut <= input.checkIn) {
    return { ok: false, error: "Las fechas ingresadas no son válidas." }
  }
  if (input.guests > unit.capacity) return { ok: false, error: "La cantidad de huéspedes supera la capacidad de la unidad." }

  if (HOLDING.has(current.status)) {
    const overlaps = (a: string, b: string) => input.checkIn < b && a < input.checkOut
    const busy =
      buildReservations(state).some(
        (r) => r.id !== id && r.unit_id === input.unitId && HOLDING.has(r.status) && overlaps(r.check_in, r.check_out)
      ) ||
      BASE_OCCUPANCY.some((o) => {
        if (o.kind !== "block" || o.unit_id !== input.unitId) return false
        const m = o.during.match(RANGE)
        return m ? overlaps(m[1], m[2]) : false
      })
    if (busy) return { ok: false, error: "Esas fechas ya están ocupadas para esa unidad." }
  }

  const price = demoStayPrice(state, input.unitId, nightsOf(input.checkIn, input.checkOut))
  const paid = current.payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + Number(p.amount), 0)
  const guest = {
    full_name: input.fullName.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
  }
  const notes = input.notes?.trim() || null

  const created = state.created.find((c) => c.id === id)
  let next: DemoState
  if (created) {
    const updated: DemoCreatedReservation = {
      ...created,
      unit_id: input.unitId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      guests_count: input.guests,
      notes,
      guest,
      total_amount: price.total,
      deposit_amount: price.deposit,
    }
    next = { ...state, created: state.created.map((c) => (c.id === id ? updated : c)) }
  } else {
    const edit: DemoReservationEdit = {
      unit_id: input.unitId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      guests_count: input.guests,
      notes,
      guest,
      total_amount: price.total,
      deposit_amount: price.deposit,
    }
    next = { ...state, edits: { ...state.edits, [id]: edit } }
  }
  const changed =
    current.unit_id !== input.unitId ||
    current.check_in !== input.checkIn ||
    current.check_out !== input.checkOut ||
    current.guests_count !== input.guests ||
    (current.notes ?? null) !== notes ||
    current.guests.full_name !== guest.full_name ||
    (current.guests.email ?? null) !== guest.email ||
    (current.guests.phone ?? null) !== guest.phone
  return {
    ok: true,
    state: next,
    summary: {
      changed,
      code: current.code,
      unitName: unit.name,
      total: price.total,
      deposit: price.deposit,
      paid,
      balance: price.total - paid,
      currency: current.currency,
    },
  }
}

/** Elimina una reserva. Con pagos acreditados no se puede: se cancela. */
export function applyDemoDelete(
  state: DemoState,
  id: string
): { ok: true; state: DemoState } | { ok: false; error: string } {
  const current = buildReservations(state).find((r) => r.id === id)
  if (!current) return { ok: false, error: "No encontramos la reserva. Puede que ya la hayan eliminado." }
  if (current.payments.some((p) => p.status === "paid" || p.status === "refunded")) {
    return { ok: false, error: "Esta reserva tiene pagos registrados, así que no se puede eliminar. Cancelala: queda en el historial." }
  }
  const statuses = { ...state.statuses }
  delete statuses[id]
  if (state.created.some((c) => c.id === id)) {
    return { ok: true, state: { ...state, created: state.created.filter((c) => c.id !== id), statuses } }
  }
  const edits = { ...state.edits }
  delete edits[id]
  return { ok: true, state: { ...state, deleted: [...state.deleted, id].slice(0, MAX_DEMO_DELETED), statuses, edits } }
}

/** Cambia el estado de una reserva (base o creada). null si el id no existe. */
export function applyDemoTransition(state: DemoState, id: string, status: string): DemoState | null {
  if (!reservationIds(state).has(id)) return null
  return { ...state, statuses: { ...state.statuses, [id]: status } }
}

export function applyDemoPropertyPatch(state: DemoState, patch: DemoPropertyPatch): DemoState {
  return { ...state, property: { ...state.property, ...patch } }
}

export function applyDemoMovement(
  state: DemoState,
  id: string,
  movement: "checkin" | "checkout",
  occurredAt: string
): { ok: true; state: DemoState } | { ok: false; error: string } {
  if (!reservationIds(state).has(id)) return { ok: false, error: "No se encontró la reserva ficticia." }
  const current = state.movements[id] ?? {}
  const field = movement === "checkin" ? "checkedInAt" : "checkedOutAt"
  if (current[field]) {
    return { ok: false, error: movement === "checkin" ? "El ingreso ya estaba registrado." : "La salida ya estaba registrada." }
  }
  return {
    ok: true,
    state: { ...state, movements: { ...state.movements, [id]: { ...current, [field]: occurredAt } } },
  }
}

/** Aplica cambios a una unidad. null si el id no existe. */
export function applyDemoUnitPatch(state: DemoState, id: string, patch: DemoUnitPatch): DemoState | null {
  if (!BASE_UNITS.some((u) => u.id === id)) return null
  return { ...state, units: { ...state.units, [id]: { ...state.units[id], ...patch } } }
}

// ------------------------------------------------------------------
// Cliente de lectura: fixtures base + estado del visitante
// ------------------------------------------------------------------

function buildReservations(state: DemoState): DemoReservation[] {
  const unitById = new Map(BASE_UNITS.map((u) => [u.id, u]))
  const fromCreated: DemoReservation[] = state.created.map((c) => {
    const unit = unitById.get(c.unit_id)!
    const movement = state.movements[c.id] ?? {}
    return {
      id: c.id,
      unit_id: c.unit_id,
      code: c.code,
      check_in: c.check_in,
      check_out: c.check_out,
      checked_in_at: movement.checkedInAt ?? null,
      checked_out_at: movement.checkedOutAt ?? null,
      guests_count: c.guests_count,
      status: state.statuses[c.id] ?? c.status,
      source: "manual",
      total_amount: c.total_amount ?? TOTAL_PER_CREATED,
      deposit_amount: c.deposit_amount ?? DEPOSIT_PER_CREATED,
      currency: "ARS",
      notes: c.notes,
      created_at: now,
      updated_at: now,
      guests: { id: `guest-${c.id}`, ...c.guest },
      units: { name: unit.name, capacity: unit.capacity },
      payments: [],
    }
  })
  const gone = new Set(state.deleted)
  const base = BASE_RESERVATIONS.filter((r) => !gone.has(r.id)).map((r) => {
    const edit = state.edits[r.id]
    const unit = unitById.get(edit?.unit_id ?? r.unit_id) ?? unitById.get(r.unit_id)!
    return {
      ...r,
      unit_id: unit.id,
      check_in: edit?.check_in ?? r.check_in,
      check_out: edit?.check_out ?? r.check_out,
      guests_count: edit?.guests_count ?? r.guests_count,
      notes: edit ? edit.notes : r.notes,
      total_amount: edit?.total_amount ?? r.total_amount,
      deposit_amount: edit?.deposit_amount ?? r.deposit_amount,
      status: state.statuses[r.id] ?? r.status,
      checked_in_at: state.movements[r.id]?.checkedInAt ?? r.checked_in_at,
      checked_out_at: state.movements[r.id]?.checkedOutAt ?? r.checked_out_at,
      payments: r.payments.map((p) => ({ ...p })),
      guests: edit ? { id: r.guests.id, ...edit.guest } : { ...r.guests },
      units: { name: unit.name, capacity: unit.capacity },
    }
  })
  return [...fromCreated, ...base]
}

function buildUnits(state: DemoState): BaseUnit[] {
  return BASE_UNITS.map((u) => ({ ...u, amenities: [...u.amenities], ...state.units[u.id] }))
}

/**
 * La ocupación sale de las reservas, igual que en la base: solo las que
 * retienen fechas ocupan, así que cancelar, eliminar o mover una reserva se ve
 * en el calendario. Los bloqueos de ejemplo no cambian.
 */
function buildOccupancy(_state: DemoState, reservations: DemoReservation[]) {
  const blocks = BASE_OCCUPANCY.filter((o) => o.kind === "block").map((o) => ({
    id: o.id, unit_id: o.unit_id, during: o.during, kind: o.kind, block_reason: o.block_reason,
    external_source: o.external_source, reservations: null,
  }))
  const held = reservations
    .filter((r) => HOLDING.has(r.status))
    .map((r) => ({
      id: `occ-${r.id}`, unit_id: r.unit_id, during: `[${r.check_in},${r.check_out})`,
      kind: "reservation", block_reason: null, external_source: null, reservations: r,
    }))
  return [...held, ...blocks]
}

function buildTables(state: DemoState): Record<string, unknown[]> {
  const reservations = buildReservations(state)
  const units = buildUnits(state)
  return {
    memberships: [{ role: "owner", organization_id: DEMO_CONTEXT.organizationId, organizations: { name: DEMO_CONTEXT.organizationName, slug: DEMO_CONTEXT.organizationSlug } }],
    profiles: [{ id: DEMO_CONTEXT.userId, full_name: DEMO_CONTEXT.fullName }],
    properties: BASE_PROPERTIES.map((p) => ({ ...p, ...state.property })),
    units,
    reservations,
    unit_occupancy: buildOccupancy(state, reservations),
    payments: reservations.flatMap((r) => r.payments.map((p) => ({ ...p, currency: r.currency }))),
    rates: BASE_RATES.map((r) => ({ ...r })),
    guests: reservations.map((r) => r.guests),
  }
}

function query(rows: unknown[]) {
  let wantsSingle = false
  let wantsCount = false
  let currentRows = [...rows]
  const builder: Record<string, unknown> = {}
  const valueAt = (row: unknown, column: string) =>
    row && typeof row === "object" ? (row as Record<string, unknown>)[column] : undefined
  const compare = (left: unknown, right: unknown) => {
    if (typeof left === "number" && typeof right === "number") return left - right
    return String(left ?? "").localeCompare(String(right ?? ""))
  }
  const resolve = () => ({ data: wantsSingle ? (currentRows[0] ?? null) : currentRows, count: wantsCount ? currentRows.length : null, error: null })
  builder.eq = (column: string, value: unknown) => {
    // La demo tiene un solo complejo y sus filas no llevan organization_id:
    // el filtro por organización del panel siempre coincide.
    if (column === "organization_id" && value === DEMO_CONTEXT.organizationId) return builder
    currentRows = currentRows.filter((row) => valueAt(row, column) === value)
    return builder
  }
  builder.in = (column: string, values: unknown[]) => {
    currentRows = currentRows.filter((row) => values.includes(valueAt(row, column)))
    return builder
  }
  for (const method of ["gte", "lte", "lt", "gt"]) {
    builder[method] = (column: string, value: unknown) => {
      currentRows = currentRows.filter((row) => {
        const left = valueAt(row, column)
        const result = compare(left, value)
        if (method === "gte") return result >= 0
        if (method === "lte") return result <= 0
        if (method === "lt") return result < 0
        return result > 0
      })
      return builder
    }
  }
  builder.not = (column: string, operator: string, raw: string) => {
    if (operator === "in") {
      const values = raw.replace(/^\(|\)$/g, "").split(",")
      currentRows = currentRows.filter((row) => !values.includes(String(valueAt(row, column))))
    }
    return builder
  }
  builder.is = (column: string, value: unknown) => {
    currentRows = currentRows.filter((row) => valueAt(row, column) === value)
    return builder
  }
  builder.order = (column: string, options?: { ascending?: boolean }) => {
    currentRows.sort((a, b) => {
      const left = valueAt(a, column)
      const right = valueAt(b, column)
      const direction = options?.ascending === false ? -1 : 1
      return compare(left, right) * direction
    })
    return builder
  }
  builder.limit = (count: number) => {
    currentRows = currentRows.slice(0, count)
    return builder
  }
  builder.range = (from: number, to: number) => {
    currentRows = currentRows.slice(from, to + 1)
    return builder
  }
  for (const method of ["overlaps", "contains", "insert", "update", "delete", "upsert"]) builder[method] = () => builder
  builder.select = (_columns?: string, options?: { count?: string; head?: boolean }) => { wantsCount = Boolean(options?.count); return builder }
  builder.maybeSingle = async () => { wantsSingle = true; return resolve() }
  builder.single = async () => { wantsSingle = true; return resolve() }
  builder.then = (onfulfilled: (value: ReturnType<typeof resolve>) => unknown, onrejected?: (reason: unknown) => unknown) => Promise.resolve(resolve()).then(onfulfilled, onrejected)
  return builder
}

/** Cliente Supabase de mentira para la demo, con el estado de ESTE visitante. */
export function createDemoClient(state: DemoState = EMPTY_DEMO_STATE) {
  const tables = buildTables(state)
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: DEMO_CONTEXT.userId, email: DEMO_CONTEXT.email } }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: null, error: { message: "El modo demo no usa credenciales." } }),
    },
    from: (table: string) => query(tables[table] ?? []),
    rpc: async (name: string) => {
      if (name === "mp_connection_status" || name === "mp_public_status") {
        return { data: name === "mp_public_status" ? { enabled: false } : { connected: false }, error: null }
      }
      if (name === "public_property") return { data: tables.properties[0], error: null }
      return { data: null, error: null }
    },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }), upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }) }) },
  }
}
