export type NotificationEvent = {
  id: string
  event_type:
    | "reservation_created_admin"
    | "reservation_status_guest"
    | "reservation_confirmed_admin"
  reservation_status: string | null
  recipient_email: string | null
  idempotency_key: string
  payload: Record<string, unknown>
}

export type RenderedEmail = {
  subject: string
  html: string
}

const STATUS_LABELS: Record<string, string> = {
  inquiry: "Consulta recibida",
  pending: "Reserva pendiente",
  pending_payment: "Esperando seña",
  confirmed: "Reserva confirmada",
  completed: "Estadía completada",
  cancelled: "Reserva cancelada",
}

function stringValue(value: unknown, fallback = "—"): string {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number") return String(value)
  return fallback
}

export function escapeHtml(value: unknown): string {
  return stringValue(value, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function formatDate(value: unknown): string {
  const raw = stringValue(value, "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—"
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${raw}T00:00:00Z`))
}

function formatMoney(value: unknown, currency: unknown): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "—"
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: stringValue(currency, "ARS"),
    maximumFractionDigits: 0,
  }).format(amount)
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:7px 12px;color:#64748b;font-size:13px">${escapeHtml(label)}</td><td style="padding:7px 12px;color:#0f172a;font-size:13px;font-weight:600">${escapeHtml(value)}</td></tr>`
}

function layout(preview: string, title: string, intro: string, rows: string): string {
  return `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(preview)}</title></head>
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
          <tr><td style="padding:22px 26px;background:#0f172a;color:#ffffff;font-size:18px;font-weight:700">Operon Reservas</td></tr>
          <tr><td style="padding:28px 26px 12px"><h1 style="margin:0;font-size:24px;line-height:1.3">${escapeHtml(title)}</h1></td></tr>
          <tr><td style="padding:0 26px 20px;color:#475569;font-size:15px;line-height:1.6">${escapeHtml(intro)}</td></tr>
          <tr><td style="padding:0 14px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border-radius:10px">${rows}</table></td></tr>
          <tr><td style="padding:18px 26px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">Mensaje automático enviado por Operon Reservas.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

export function renderReservationEmail(event: NotificationEvent): RenderedEmail {
  const payload = event.payload ?? {}
  const code = stringValue(payload.reservation_code)
  const property = stringValue(payload.property_name, stringValue(payload.organization_name))
  const status = stringValue(payload.new_status, stringValue(event.reservation_status, "pending"))
  const statusLabel = STATUS_LABELS[status] ?? status

  const commonRows = [
    row("Código", code),
    row("Alojamiento", property),
    row("Unidad", stringValue(payload.unit_name)),
    row("Ingreso", formatDate(payload.check_in)),
    row("Salida", formatDate(payload.check_out)),
    row("Huéspedes", stringValue(payload.guests_count)),
  ]

  if (event.event_type === "reservation_created_admin") {
    const rows = [
      ...commonRows,
      row("Total", formatMoney(payload.total_amount, payload.currency)),
      row("Estado", statusLabel),
    ].join("")

    return {
      subject: `Nueva reserva ${code} · ${property}`,
      html: layout(
        `Nueva reserva ${code}`,
        "Ingresó una nueva reserva",
        `Revisá los datos de la solicitud recibida para ${property}.`,
        rows
      ),
    }
  }

  if (event.event_type === "reservation_confirmed_admin") {
    const total = Number(payload.total_amount)
    const deposit = Number(payload.deposit_amount)
    const balance = Number.isFinite(total) && Number.isFinite(deposit) ? total - deposit : null

    const rows = [
      row("Huésped", stringValue(payload.guest_name)),
      ...commonRows,
      row("Seña acreditada", formatMoney(payload.deposit_amount, payload.currency)),
      row("Saldo pendiente", formatMoney(balance, payload.currency)),
    ].join("")

    return {
      subject: `Nueva reserva confirmada ${code} · ${property}`,
      html: layout(
        `Reserva confirmada ${code}`,
        "Nueva reserva confirmada",
        `Se acreditó la seña y la reserva de ${property} quedó confirmada automáticamente.`,
        rows
      ),
    }
  }

  const rows = [
    ...commonRows,
    row("Estado", statusLabel),
    row("Total", formatMoney(payload.total_amount, payload.currency)),
    row("Seña", formatMoney(payload.deposit_amount, payload.currency)),
  ].join("")

  return {
    subject: `${statusLabel}: reserva ${code}`,
    html: layout(
      `${statusLabel} · ${code}`,
      statusLabel,
      `El estado de tu reserva en ${property} cambió.`,
      rows
    ),
  }
}
