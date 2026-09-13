const now = "2026-09-08T12:00:00.000Z"

export const DEMO_CONTEXT = {
  userId: "demo-user",
  email: "demo@operon.app",
  fullName: "Lucía Herrera",
  organizationId: "demo-org",
  organizationName: "Refugio Alto Cielo",
  organizationSlug: "refugio-alto-cielo",
  role: "owner",
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
  properties: { name: string }
}

const BASE_UNITS: readonly BaseUnit[] = [
  { id: "unit-1", property_id: "property-1", name: "Cabaña del Bosque", capacity: 4, is_active: true, position: 1, description: "Dos dormitorios, galería y vista al monte.", photo_path: "https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=1400&q=85", amenities: ["Parrilla", "Wi-Fi", "Cocina equipada"], airbnb_ical_url: null, booking_ical_url: null, properties: { name: "Refugio Alto Cielo" } },
  { id: "unit-2", property_id: "property-1", name: "Suite Mirador", capacity: 2, is_active: true, position: 2, description: "Suite íntima con terraza privada.", photo_path: "https://images.unsplash.com/photo-1601918774946-25832a4be0d6?auto=format&fit=crop&w=1400&q=85", amenities: ["Desayuno", "Aire acondicionado", "Deck"], airbnb_ical_url: null, booking_ical_url: null, properties: { name: "Refugio Alto Cielo" } },
  { id: "unit-3", property_id: "property-1", name: "Casa del Arroyo", capacity: 6, is_active: true, position: 3, description: "Espacio amplio para familias, junto al arroyo.", photo_path: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=85", amenities: ["Pileta", "Lavadero", "Cochera"], airbnb_ical_url: null, booking_ical_url: null, properties: { name: "Refugio Alto Cielo" } },
]

type DemoReservation = {
  id: string
  code: string
  check_in: string
  check_out: string
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
  { id: "res-1", code: "AC-4821", check_in: "2026-09-12", check_out: "2026-09-16", guests_count: 3, status: "pending_payment", source: "direct", total_amount: 592000, deposit_amount: 296000, currency: "ARS", notes: "Llega cerca de las 18 h.", created_at: now, updated_at: now, guests: { id: "guest-1", full_name: "Martina Roldán", email: "martina@ejemplo.com", phone: "+5493515550101" }, units: { name: "Cabaña del Bosque", capacity: 4 }, payments: [{ amount: 296000, status: "paid", kind: "deposit", paid_at: now }] },
  { id: "res-2", code: "AC-4820", check_in: "2026-09-10", check_out: "2026-09-13", guests_count: 2, status: "confirmed", source: "whatsapp", total_amount: 336000, deposit_amount: 168000, currency: "ARS", notes: null, created_at: now, updated_at: now, guests: { id: "guest-2", full_name: "Tomás Ledesma", email: "tomas@ejemplo.com", phone: "+5493515550102" }, units: { name: "Suite Mirador", capacity: 2 }, payments: [{ amount: 336000, status: "paid", kind: "balance", paid_at: now }] },
  { id: "res-3", code: "AC-4818", check_in: "2026-09-14", check_out: "2026-09-18", guests_count: 5, status: "pending", source: "booking", total_amount: 780000, deposit_amount: 390000, currency: "ARS", notes: null, created_at: now, updated_at: now, guests: { id: "guest-3", full_name: "Paula Méndez", email: "paula@ejemplo.com", phone: "+5493515550103" }, units: { name: "Casa del Arroyo", capacity: 6 }, payments: [] },
]

const BASE_OCCUPANCY = [
  { id: "occ-1", unit_id: "unit-1", during: "[2026-09-12,2026-09-16)", kind: "reservation", block_reason: null, reservationId: "res-1" },
  { id: "occ-2", unit_id: "unit-2", during: "[2026-09-10,2026-09-13)", kind: "reservation", block_reason: null, reservationId: "res-2" },
  { id: "occ-3", unit_id: "unit-3", during: "[2026-09-14,2026-09-18)", kind: "reservation", block_reason: null, reservationId: "res-3" },
] as const

const BASE_PROPERTIES = [{ id: "property-1", name: "Refugio Alto Cielo", slug: "refugio-alto-cielo", city: "San Javier, Córdoba", description: "Tres espacios para descansar entre sierras.", currency: "ARS", checkin_time: "14:00", checkout_time: "10:00", deposit_pct: 50, whatsapp: null, phone: null, created_at: now }]
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
}

export type DemoState = {
  /** Reservas que cargó este visitante, de la más nueva a la más vieja. */
  created: DemoCreatedReservation[]
  /** id de reserva (base o creada) → nuevo estado. */
  statuses: Record<string, string>
  /** id de unidad → cambios de este visitante. */
  units: Record<string, DemoUnitPatch>
}

export const EMPTY_DEMO_STATE: DemoState = { created: [], statuses: {}, units: {} }

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
  return new Set([...BASE_RESERVATIONS.map((r) => r.id), ...state.created.map((r) => r.id)])
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

/** Cambia el estado de una reserva (base o creada). null si el id no existe. */
export function applyDemoTransition(state: DemoState, id: string, status: string): DemoState | null {
  if (!reservationIds(state).has(id)) return null
  return { ...state, statuses: { ...state.statuses, [id]: status } }
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
    return {
      id: c.id,
      code: c.code,
      check_in: c.check_in,
      check_out: c.check_out,
      guests_count: c.guests_count,
      status: state.statuses[c.id] ?? c.status,
      source: "manual",
      total_amount: TOTAL_PER_CREATED,
      deposit_amount: DEPOSIT_PER_CREATED,
      currency: "ARS",
      notes: c.notes,
      created_at: now,
      updated_at: now,
      guests: { id: `guest-${c.id}`, ...c.guest },
      units: { name: unit.name, capacity: unit.capacity },
      payments: [],
    }
  })
  const base = BASE_RESERVATIONS.map((r) => ({
    ...r,
    status: state.statuses[r.id] ?? r.status,
    payments: r.payments.map((p) => ({ ...p })),
    guests: { ...r.guests },
    units: { ...r.units },
  }))
  return [...fromCreated, ...base]
}

function buildUnits(state: DemoState): BaseUnit[] {
  return BASE_UNITS.map((u) => ({ ...u, amenities: [...u.amenities], ...state.units[u.id] }))
}

function buildOccupancy(state: DemoState, reservations: DemoReservation[]) {
  const byId = new Map(reservations.map((r) => [r.id, r]))
  const base = BASE_OCCUPANCY.map((o) => ({
    id: o.id, unit_id: o.unit_id, during: o.during, kind: o.kind, block_reason: o.block_reason,
    reservations: byId.get(o.reservationId) ?? null,
  }))
  const created = state.created.map((c) => ({
    id: `occ-${c.id}`, unit_id: c.unit_id, during: `[${c.check_in},${c.check_out})`,
    kind: "reservation", block_reason: null, reservations: byId.get(c.id) ?? null,
  }))
  return [...base, ...created]
}

function buildTables(state: DemoState): Record<string, unknown[]> {
  const reservations = buildReservations(state)
  const units = buildUnits(state)
  return {
    memberships: [{ role: "owner", organization_id: DEMO_CONTEXT.organizationId, organizations: { name: DEMO_CONTEXT.organizationName, slug: DEMO_CONTEXT.organizationSlug } }],
    profiles: [{ id: DEMO_CONTEXT.userId, full_name: DEMO_CONTEXT.fullName }],
    properties: BASE_PROPERTIES.map((p) => ({ ...p })),
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
  const builder: Record<string, unknown> = {}
  const resolve = () => ({ data: wantsSingle ? (rows[0] ?? null) : rows, count: wantsCount ? rows.length : null, error: null })
  for (const method of ["eq", "in", "gte", "lte", "lt", "gt", "not", "overlaps", "order", "limit", "range", "is", "contains", "insert", "update", "delete", "upsert"]) builder[method] = () => builder
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
    rpc: async (name: string) => name === "mp_connection_status" ? { data: { connected: false }, error: null } : { data: null, error: null },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }), upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }) }) },
  }
}
