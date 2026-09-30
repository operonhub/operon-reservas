/**
 * Lo que devuelven las RPC del panel interno (0033). Ninguna trae plata del
 * cliente: es privada y no sale de la base hacia este panel.
 */

export type ClientRow = {
  organization_id: string
  name: string
  slug: string
  created_at: string
  suspended_at: string | null
  owner_email: string | null
  owner_name: string | null
  last_sign_in_at: string | null
  members: number
  units: number
  reservations_total: number
  reservations_month: number
  last_reservation_at: string | null
  deposit_configured: boolean
  mp_connected: boolean
  mp_live: boolean
  link_shared: boolean
  email_failed_30d: number
  email_stuck: number
}

export type ClientMember = {
  user_id: string
  email: string
  full_name: string | null
  role: "owner" | "admin" | "staff"
  joined_at: string
  last_sign_in_at: string | null
  is_platform_admin: boolean
}

export type ClientDetail = {
  org: {
    id: string
    name: string
    slug: string
    created_at: string
    suspended_at: string | null
    suspension: { at: string; reason: string | null; actor_email: string | null } | null
    link_shared_at: string | null
    checklist_dismissed_at: string | null
  }
  members: ClientMember[]
  properties: {
    id: string
    name: string
    slug: string
    city: string | null
    country: string | null
    timezone: string
    is_active: boolean
    deposit_configured: boolean
    has_contact: boolean
  }[]
  units: {
    id: string
    name: string
    capacity: number
    is_active: boolean
    has_photo: boolean
    airbnb_configured: boolean
    booking_configured: boolean
  }[]
  reservations: {
    total: number
    month: number
    last_at: string | null
    by_status: Record<string, number>
    recent: {
      code: string
      status: string
      source: string
      check_in: string
      check_out: string
      guest_name: string | null
      unit_name: string | null
      created_at: string
    }[]
  }
  mercadopago: { connected: boolean; live: boolean; connected_at: string | null }
  email_health: {
    sent_30d: number
    failed_final: number
    retrying: number
    stuck: number
    last_failed_at: string | null
    last_error: string | null
  }
}

export type AuditEntry = {
  id: number
  created_at: string
  actor_email: string | null
  action: string
  organization_id: string | null
  organization_name: string | null
  target_email: string | null
  detail: Record<string, unknown>
  reason: string | null
}

export const ACTION_LABELS: Record<string, string> = {
  "org.suspend": "Suspendió el complejo",
  "org.reactivate": "Reactivó el complejo",
  "member.remove": "Quitó a un miembro",
  "member.recovery_link": "Generó un link de nueva contraseña",
  "invitation.create": "Creó una invitación",
  "invitation.revoke": "Revocó una invitación",
  "zone_month.enable": "Activó Tu zona",
  "zone_month.disable": "Desactivó Tu zona",
  "zone_month.queue": "Pidió generar Tu zona",
}

export const ROLE_LABELS: Record<ClientMember["role"], string> = {
  owner: "Dueño",
  admin: "Administrador",
  staff: "Equipo",
}

export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  inquiry: "Consulta",
  pending: "Pendiente",
  pending_payment: "Esperando pago",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  expired: "Vencida",
}
