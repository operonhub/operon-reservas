import { timingSafeEqual } from "node:crypto"
import { runZoneMonth } from "@/lib/zone-month/worker"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const received = Buffer.from(request.headers.get("authorization") || "")
  const expected = Buffer.from(`Bearer ${secret || ""}`)
  if (!secret || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (process.env.ZONE_MONTH_ENABLED !== "1" || process.env.DEMO_ONLY === "1") {
    return Response.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } })
  }
  try {
    const result = await runZoneMonth()
    return Response.json(result, { status: result.failed ? 503 : 200, headers: { "Cache-Control": "no-store" } })
  } catch {
    // Nunca devolver mensajes SQL, claves, cuerpos del proveedor o datos del tenant.
    return Response.json({ error: "Worker unavailable" }, { status: 503 })
  }
}
