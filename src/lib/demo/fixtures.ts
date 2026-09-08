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

const units = [
  { id: "unit-1", property_id: "property-1", name: "Cabaña del Bosque", capacity: 4, is_active: true, position: 1, description: "Dos dormitorios, galería y vista al monte.", photo_path: "https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=1400&q=85", amenities: ["Parrilla", "Wi-Fi", "Cocina equipada"], airbnb_ical_url: null, booking_ical_url: null, properties: { name: "Refugio Alto Cielo" } },
  { id: "unit-2", property_id: "property-1", name: "Suite Mirador", capacity: 2, is_active: true, position: 2, description: "Suite íntima con terraza privada.", photo_path: "https://images.unsplash.com/photo-1601918774946-25832a4be0d6?auto=format&fit=crop&w=1400&q=85", amenities: ["Desayuno", "Aire acondicionado", "Deck"], airbnb_ical_url: null, booking_ical_url: null, properties: { name: "Refugio Alto Cielo" } },
  { id: "unit-3", property_id: "property-1", name: "Casa del Arroyo", capacity: 6, is_active: true, position: 3, description: "Espacio amplio para familias, junto al arroyo.", photo_path: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1400&q=85", amenities: ["Pileta", "Lavadero", "Cochera"], airbnb_ical_url: null, booking_ical_url: null, properties: { name: "Refugio Alto Cielo" } },
]

const reservations = [
  { id: "res-1", code: "AC-4821", check_in: "2026-09-12", check_out: "2026-09-16", guests_count: 3, status: "pending_payment", source: "direct", total_amount: 592000, deposit_amount: 296000, currency: "ARS", notes: "Llega cerca de las 18 h.", created_at: now, updated_at: now, guests: { id: "guest-1", full_name: "Martina Roldán", email: "martina@ejemplo.com", phone: "+5493515550101" }, units: { name: "Cabaña del Bosque", capacity: 4 }, payments: [{ amount: 296000, status: "paid", kind: "deposit", paid_at: now }] },
  { id: "res-2", code: "AC-4820", check_in: "2026-09-10", check_out: "2026-09-13", guests_count: 2, status: "confirmed", source: "whatsapp", total_amount: 336000, deposit_amount: 168000, currency: "ARS", notes: null, created_at: now, updated_at: now, guests: { id: "guest-2", full_name: "Tomás Ledesma", email: "tomas@ejemplo.com", phone: "+5493515550102" }, units: { name: "Suite Mirador", capacity: 2 }, payments: [{ amount: 336000, status: "paid", kind: "balance", paid_at: now }] },
  { id: "res-3", code: "AC-4818", check_in: "2026-09-14", check_out: "2026-09-18", guests_count: 5, status: "pending", source: "booking", total_amount: 780000, deposit_amount: 390000, currency: "ARS", notes: null, created_at: now, updated_at: now, guests: { id: "guest-3", full_name: "Paula Méndez", email: "paula@ejemplo.com", phone: "+5493515550103" }, units: { name: "Casa del Arroyo", capacity: 6 }, payments: [] },
]

const occupancy = [
  { id: "occ-1", unit_id: "unit-1", during: "[2026-09-12,2026-09-16)", kind: "reservation", block_reason: null, reservations: reservations[0] },
  { id: "occ-2", unit_id: "unit-2", during: "[2026-09-10,2026-09-13)", kind: "reservation", block_reason: null, reservations: reservations[1] },
  { id: "occ-3", unit_id: "unit-3", during: "[2026-09-14,2026-09-18)", kind: "reservation", block_reason: null, reservations: reservations[2] },
]

const properties = [{ id: "property-1", name: "Refugio Alto Cielo", slug: "refugio-alto-cielo", city: "San Javier, Córdoba", description: "Tres espacios para descansar entre sierras.", currency: "ARS", checkin_time: "14:00", checkout_time: "10:00", deposit_pct: 50, whatsapp: null, phone: null, created_at: now }]
const rates = units.map((unit, index) => ({ id: `rate-${index}`, unit_id: unit.id, kind: "base", label: "Tarifa base", price_per_night: [148000, 112000, 195000][index], discount_pct: null, weekdays: null, min_guests: null, max_guests: null, min_nights: null, min_nights_rule: null, priority: 0, start_date: null, end_date: null, is_active: true, currency: "ARS" }))

const tables: Record<string, unknown[]> = {
  memberships: [{ role: "owner", organization_id: DEMO_CONTEXT.organizationId, organizations: { name: DEMO_CONTEXT.organizationName, slug: DEMO_CONTEXT.organizationSlug } }],
  profiles: [{ id: DEMO_CONTEXT.userId, full_name: DEMO_CONTEXT.fullName }],
  properties,
  units,
  reservations,
  unit_occupancy: occupancy,
  payments: reservations.flatMap((reservation) => reservation.payments.map((payment) => ({ ...payment, currency: reservation.currency }))),
  rates,
  guests: reservations.map((reservation) => reservation.guests),
}

function query(table: string) {
  const rows = tables[table] ?? []
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

export function createDemoClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: DEMO_CONTEXT.userId, email: DEMO_CONTEXT.email } }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: null, error: { message: "El modo demo no usa credenciales." } }),
    },
    from: (table: string) => query(table),
    rpc: async (name: string) => name === "mp_connection_status" ? { data: { connected: false }, error: null } : { data: null, error: null },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }), upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }) }) },
  }
}

export function demoTransitionReservation(id: string, status: string) {
  const reservation = reservations.find((item) => item.id === id)
  if (!reservation) return false
  reservation.status = status
  return true
}

export function demoCreateManualReservation(input: { unitId: string; fullName: string; email: string | null; phone: string | null; checkIn: string; checkOut: string; guests: number; status: string; notes: string | null }) {
  const unit = units.find((item) => item.id === input.unitId)
  if (!unit) return null
  const id = `demo-${Date.now()}`
  const guest = { id: `guest-${Date.now()}`, full_name: input.fullName, email: input.email, phone: input.phone }
  const reservation = { id, code: `AC-${4830 + reservations.length}`, check_in: input.checkIn, check_out: input.checkOut, guests_count: input.guests, status: input.status, source: "manual", total_amount: 420000, deposit_amount: 210000, currency: "ARS", notes: input.notes, created_at: now, updated_at: now, guests: guest, units: { name: unit.name, capacity: unit.capacity }, payments: [] as { amount: number; status: string; kind: string; paid_at: string | null }[] }
  reservations.unshift(reservation)
  occupancy.push({ id: `occ-${Date.now()}`, unit_id: unit.id, during: `[${input.checkIn},${input.checkOut})`, kind: "reservation", block_reason: null, reservations: reservation })
  return { id }
}

export function demoUpdateUnit(id: string, patch: Record<string, unknown>) {
  const unit = units.find((item) => item.id === id)
  if (!unit) return false
  Object.assign(unit, patch)
  return true
}
