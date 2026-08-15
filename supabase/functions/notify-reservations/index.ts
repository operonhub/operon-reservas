import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import {
  renderReservationEmail,
  type NotificationEvent,
} from "../_shared/reservation-email.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? ""

function publishableKey(): string {
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if (publishableKeys) {
    try {
      const parsed = JSON.parse(publishableKeys) as Record<string, string>
      if (parsed.default) return parsed.default
    } catch {
      // Sigue con la clave legacy durante la transición de Supabase.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? ""
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const key = publishableKey()
  if (!SUPABASE_URL || !key) throw new Error("SUPABASE_PUBLIC_CONFIG_MISSING")

  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`RPC_${name.toUpperCase()}_${response.status}: ${detail}`)
  }
  return (await response.json()) as T
}

async function markFailed(workerToken: string, id: string, message: string): Promise<void> {
  await rpc<boolean>("fail_notification", {
    p_worker_token: workerToken,
    p_id: id,
    p_error: message,
  })
}

async function processEvent(
  workerToken: string,
  event: NotificationEvent
): Promise<"sent" | "failed" | "skipped"> {
  if (!event.recipient_email) {
    await rpc<boolean>("skip_notification", {
      p_worker_token: workerToken,
      p_id: event.id,
      p_reason: "RECIPIENT_EMAIL_NOT_CONFIGURED",
    })
    return "skipped"
  }

  if (!RESEND_API_KEY || !RESEND_FROM) {
    await markFailed(workerToken, event.id, "RESEND_SECRETS_NOT_CONFIGURED")
    return "failed"
  }

  const email = renderReservationEmail(event)
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": event.idempotency_key,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [event.recipient_email],
        subject: email.subject,
        html: email.html,
      }),
    })

    const result = (await response.json().catch(() => ({}))) as {
      id?: string
      message?: string
      name?: string
    }

    if (!response.ok) {
      await markFailed(
        workerToken,
        event.id,
        `RESEND_${response.status}: ${result.message ?? result.name ?? "UNKNOWN_ERROR"}`
      )
      return "failed"
    }

    await rpc<boolean>("complete_notification", {
      p_worker_token: workerToken,
      p_id: event.id,
      p_provider_message_id: result.id ?? "",
    })
    return "sent"
  } catch (error) {
    await markFailed(
      workerToken,
      event.id,
      error instanceof Error ? error.message : "SEND_FAILED"
    )
    return "failed"
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 })
  }

  const workerToken = request.headers.get("x-worker-token") ?? ""
  try {
    const events = await rpc<NotificationEvent[]>("claim_notification_batch", {
      p_worker_token: workerToken,
      p_limit: 10,
    })
    const summary = {
      configured: Boolean(RESEND_API_KEY && RESEND_FROM),
      claimed: events.length,
      sent: 0,
      failed: 0,
      skipped: 0,
    }

    for (const event of events) {
      const result = await processEvent(workerToken, event)
      summary[result] += 1
    }

    return Response.json(summary)
  } catch (error) {
    if (error instanceof Error && error.message.includes("FORBIDDEN")) {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "WORKER_FAILED" },
      { status: 500 }
    )
  }
})
