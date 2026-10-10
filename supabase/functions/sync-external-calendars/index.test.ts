// Ejecuta el handler real con calendarios sintéticos y todas las llamadas HTTP
// simuladas. Un feed incompleto nunca debe convertirse en reservas ausentes.
import { assertEquals } from "jsr:@std/assert@1"

type Handler = (request: Request) => Promise<Response>
type Unit = {
  unit_id: string
  organization_id: string
  airbnb_ical_url: string | null
  booking_ical_url: string | null
}
type RpcCall = { name: string; body: Record<string, unknown> }

const SUPABASE_URL = "https://ical-project.test"
const SERVICE_KEY = "synthetic-service-key"
const WORKER_TOKEN = "synthetic-worker-token"
const FEED_TOKEN = "synthetic-feed-token"
const PRIVATE_UID = "synthetic-private-reservation@test"
const summary = { inserted: 1, updated: 0, removed: 0, skipped_conflicts: 0 }
const zeroTotals = { inserted: 0, updated: 0, removed: 0, skipped_conflicts: 0 }

const calendar = (...events: string[]) => [
  "BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR", "",
].join("\r\n")

const event = (...fields: string[]) => ["BEGIN:VEVENT", ...fields, "END:VEVENT"].join("\r\n")
const validEvent = event(
  "UID:valid-reservation@test",
  "DTSTART;VALUE=DATE:20261010",
  "DTEND;VALUE=DATE:20261013",
)
const feedUrl = (id: string) => `https://calendars.test/${id}.ics?token=${FEED_TOKEN}`
const unit = (id: string): Unit => ({
  unit_id: id,
  organization_id: "synthetic-organization",
  airbnb_ical_url: feedUrl(id),
  booking_ical_url: null,
})

Deno.test("el worker iCal sincroniza solamente calendarios íntegros", async (t) => {
  const savedFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch")!
  const savedServe = Object.getOwnPropertyDescriptor(Deno, "serve")!
  const environment = new Map([
    ["SUPABASE_URL", Deno.env.get("SUPABASE_URL")],
    ["SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")],
  ])
  let handler: Handler | undefined
  let units: Unit[] = []
  let feeds = new Map<string, string>()
  let rpcCalls: RpcCall[] = []
  let fetchedFeeds: string[] = []

  try {
    Deno.env.set("SUPABASE_URL", SUPABASE_URL)
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    Object.defineProperty(Deno, "serve", {
      configurable: true,
      enumerable: savedServe.enumerable,
      value: (captured: Handler) => { handler = captured },
    })
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      enumerable: savedFetch.enumerable,
      writable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input)
        const rpcPrefix = `${SUPABASE_URL}/rest/v1/rpc/`
        if (url.startsWith(rpcPrefix)) {
          const name = url.slice(rpcPrefix.length)
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          rpcCalls.push({ name, body })
          assertEquals(init?.method, "POST")
          const headers = new Headers(init?.headers)
          assertEquals(headers.get("authorization"), `Bearer ${SERVICE_KEY}`)
          if (name === "is_ical_sync_worker") return Response.json(body.p_token === WORKER_TOKEN)
          if (name === "list_units_for_ical_sync") return Response.json(units)
          if (name === "sync_unit_external_blocks") return Response.json(summary)
          if (name === "report_ical_sync_results") return Response.json(units.length)
          throw new Error(`Unexpected RPC: ${name}`)
        }
        const feed = feeds.get(url)
        if (feed === undefined) throw new Error("Unexpected feed request")
        fetchedFeeds.push(url)
        assertEquals(init?.redirect, "manual")
        assertEquals(new Headers(init?.headers).has("authorization"), false)
        return new Response(feed, { headers: { "content-type": "text/calendar" } })
      },
    })
    await import("./index.ts")
    if (!handler) throw new Error("The worker did not register its handler")
    const realHandler = handler

    async function run(batch: Unit[], content: Map<string, string>) {
      units = batch
      feeds = content
      rpcCalls = []
      fetchedFeeds = []
      const response = await realHandler(new Request("https://worker.test/sync", {
        method: "POST",
        headers: { "x-worker-token": WORKER_TOKEN },
      }))
      assertEquals(response.status, 200)
      const result = await response.json()
      const reports = rpcCalls.filter((call) => call.name === "report_ical_sync_results")
      assertEquals(reports.length, 1)
      assertEquals(reports[0].body.p_worker_token, WORKER_TOKEN)
      const exposed = JSON.stringify({ result, report: reports[0].body.p_results })
      for (const secret of [SERVICE_KEY, WORKER_TOKEN, FEED_TOKEN, PRIVATE_UID]) {
        assertEquals(exposed.includes(secret), false, "El resultado público y el reporte no deben exponer secretos")
      }
      return {
        result,
        report: reports[0].body.p_results,
        syncs: rpcCalls.filter((call) => call.name === "sync_unit_external_blocks"),
      }
    }

    await t.step("un documento sin envoltorio VCALENDAR sigue siendo NOT_ICAL", async () => {
      const invalidFeeds = ["<html>Login</html>", validEvent, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"]
      const batch = invalidFeeds.map((_, index) => unit(`not-ical-${index}`))
      const { result, report, syncs } = await run(batch, new Map(batch.map((row, index) => [row.airbnb_ical_url!, invalidFeeds[index]])))
      const errors = batch.map((row) => ({ unit_id: row.unit_id, source: "airbnb", error: "NOT_ICAL" }))
      assertEquals(syncs, [])
      assertEquals(result, { units_processed: 3, platforms_ok: 0, platforms_error: 3, errors, totals: zeroTotals })
      assertEquals(report, errors.map((error) => ({ ...error, ok: false })))
    })

    await t.step("un solo evento inválido rechaza todo su calendario y no llama al RPC de sync", async () => {
      const uid = `UID:${PRIVATE_UID}`
      const start = "DTSTART;VALUE=DATE:20261010"
      const end = "DTEND;VALUE=DATE:20261013"
      const invalidEvents = [
        event(start, end),
        event(uid, end),
        event(uid, start),
        event("UID:   ", start, end),
        event(uid, "DTSTART;VALUE=DATE:20260230", end),
        event(uid, start, "DTEND;VALUE=DATE:20261301"),
        event(uid, "DTSTART:20261010T250000Z", "DTEND:20261013T100000Z"),
        event(uid, "DTSTART;VALUE=DATE:2026-10-10", end),
        event(uid, start, "DTEND;VALUE=DATE:20261009"),
        event(uid, start, "DTEND;VALUE=DATE:20261010"),
        event(uid, uid, start, end),
        event(uid, start, start, end),
        event(uid, start, end, end),
        event(uid, start, end, "RRULE:FREQ=DAILY;COUNT=3"),
        event(uid, start, end, "RDATE;VALUE=DATE:20261020"),
        event(uid, start, end, "EXDATE;VALUE=DATE:20261011"),
        event(uid, start, end, "RECURRENCE-ID;VALUE=DATE:20261010"),
        event(uid, start, end, "DURATION:P3D"),
        ["BEGIN:VEVENT", uid, start, end].join("\r\n"),
      ]
      // Cada caso se prueba solo y junto a una reserva válida: ni un falso vacío
      // ni un subconjunto del feed pueden llegar al RPC de sincronización.
      const malformed = invalidEvents.flatMap((invalid) => [calendar(invalid), calendar(validEvent, invalid)])
      const batch = malformed.map((_, index) => unit(`malformed-${index}`))
      const content = new Map(batch.map((row, index) => [row.airbnb_ical_url!, malformed[index]]))
      const { result, report, syncs } = await run(batch, content)
      const errors = batch.map((row) => ({ unit_id: row.unit_id, source: "airbnb", error: "INVALID_ICAL" }))
      assertEquals(syncs, [])
      assertEquals(fetchedFeeds.length, batch.length)
      assertEquals(result, { units_processed: batch.length, platforms_ok: 0, platforms_error: batch.length, errors, totals: zeroTotals })
      assertEquals(report, errors.map((error) => ({ ...error, ok: false })))
    })

    await t.step("un calendario íntegro vacío conserva p_allow_empty", async () => {
      const row = unit("empty")
      const { result, report, syncs } = await run([row], new Map([[row.airbnb_ical_url!, calendar()]]))
      assertEquals(syncs, [{
        name: "sync_unit_external_blocks",
        body: { p_worker_token: WORKER_TOKEN, p_unit_id: row.unit_id, p_source: "airbnb", p_ranges: [], p_allow_empty: true },
      }])
      assertEquals(result.platforms_ok, 1)
      assertEquals(result.platforms_error, 0)
      assertEquals(report, [{ unit_id: row.unit_id, source: "airbnb", ok: true, error: null }])
    })

    await t.step("estructuras cortadas o UID con fechas contradictorias rechazan el feed completo", async () => {
      const conflictingEvent = event(
        "UID:valid-reservation@test", "DTSTART;VALUE=DATE:20261020", "DTEND;VALUE=DATE:20261023",
      )
      const misspelledEvent = validEvent.replaceAll("VEVENT", "VEVEN")
      const malformed = [
        calendar(`UID:${PRIVATE_UID}`, "DTSTART:20261010", "DTEND:20261013"),
        calendar(validEvent, `UID:${PRIVATE_UID}`, "DTSTART:20261010", "DTEND:20261013"),
        calendar("BEGIN :VEVENT", `UID:${PRIVATE_UID}`, "DTSTART:20261010", "DTEND:20261013", "END :VEVENT"),
        calendar(validEvent, "END:VEVENT"),
        calendar("BEGIN:VEVENT", validEvent, "END:VEVENT"),
        calendar(validEvent, "BEGIN:VTIMEZONE", "TZID:unfinished@test"),
        calendar([
          "BEGIN:VEVENT", `UID:${PRIVATE_UID}`, "DTSTART:20261010", "DTEND:20261013",
          "BEGIN:VALARM", "END:VEVENT", "END:VALARM",
        ].join("\r\n")),
        calendar(validEvent, conflictingEvent),
        calendar(misspelledEvent),
        calendar(validEvent, misspelledEvent),
        calendar("BEGIN:VALARM", "ACTION:DISPLAY", "END:VALARM"),
        calendar("BEGIN:STANDARD", "DTSTART:20261101T020000", "END:STANDARD"),
        calendar("BEGIN:VTIMEZONE", "BEGIN:VALARM", "END:VALARM", "END:VTIMEZONE"),
        calendar(event(
          `UID:${PRIVATE_UID}`, "DTSTART:20261010", "DTEND:20261013",
          "BEGIN:VTIMEZONE", "END:VTIMEZONE",
        )),
        `${calendar(validEvent)}${calendar()}`,
      ]
      const batch = malformed.map((_, index) => unit(`structure-${index}`))
      const { result, report, syncs } = await run(batch, new Map(batch.map((row, index) => [row.airbnb_ical_url!, malformed[index]])))
      const errors = batch.map((row) => ({ unit_id: row.unit_id, source: "airbnb", error: "INVALID_ICAL" }))
      assertEquals(syncs, [])
      assertEquals(result, { units_processed: batch.length, platforms_ok: 0, platforms_error: batch.length, errors, totals: zeroTotals })
      assertEquals(report, errors.map((error) => ({ ...error, ok: false })))
    })

    await t.step("conserva mayúsculas/minúsculas, líneas plegadas, zonas horarias y alarmas válidas", async () => {
      const compatibleLines = [
        "begin:vcalendar", "version:2.0", "UID:calendar-metadata@test", "X-WR-CALNAME:Calendario sintético", "BEGIN:VTIMEZONE",
        "TZID:America/New_York", "BEGIN:STANDARD",
        "DTSTART:20261101T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD", "BEGIN:DAYLIGHT",
        "DTSTART:20260308T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
        "END:VTIMEZONE", "begin:vevent", "uid:folded-",
        "\treservation@test", "dtstart;value=DATE:20280229", "dtend;value=DATE:20280302",
        "X-CUSTOM-BOOKING-ID:synthetic-reference",
        "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Recordatorio",
        "END:VALARM", "end:vevent", "end:vcalendar", "",
      ]
      const newlines = ["\r\n", "\n", "\r"]
      const batch = newlines.map((_, index) => unit(`compatible-${index}`))
      const { result, syncs } = await run(batch, new Map(batch.map((row, index) => [
        row.airbnb_ical_url!, `${index === 0 ? "\uFEFF" : ""}${compatibleLines.join(newlines[index])}`,
      ])))
      assertEquals(syncs, batch.map((row) => ({
        name: "sync_unit_external_blocks",
        body: {
          p_worker_token: WORKER_TOKEN, p_unit_id: row.unit_id, p_source: "airbnb",
          p_ranges: [{ uid: "folded-reservation@test", start_date: "2028-02-29", end_date: "2028-03-02" }],
        },
      })))
      assertEquals(result.platforms_ok, batch.length)
      assertEquals(result.platforms_error, 0)
    })

    await t.step("un feed inválido no frena la otra plataforma ni otra unidad del batch", async () => {
      const first = { ...unit("shared-unit"), booking_ical_url: feedUrl("booking-valid") }
      const second = unit("next-unit")
      const dateTimeEvent = event(
        "UID:time-reservation@test",
        "DTSTART;TZID=America/Argentina/Buenos_Aires:20261014T150000",
        "DTEND;TZID=America/Argentina/Buenos_Aires:20261017T100000",
      )
      const utcEvent = event(
        "UID:utc-reservation@test", "DTSTART:20261020T000000Z", "DTEND:20261023T000000Z",
      )
      const floatingEvent = event(
        "UID:floating-reservation@test", "DTSTART:20261025T150000", "DTEND:20261027T100000",
      )
      const { result, report, syncs } = await run([first, second], new Map([
        [first.airbnb_ical_url!, calendar(event(`UID:${PRIVATE_UID}`, "DTSTART;VALUE=DATE:20261010"))],
        [first.booking_ical_url, calendar(validEvent, dateTimeEvent, utcEvent, floatingEvent)],
        [second.airbnb_ical_url!, calendar(validEvent, validEvent)],
      ]))
      assertEquals(syncs, [
        {
          name: "sync_unit_external_blocks",
          body: {
            p_worker_token: WORKER_TOKEN, p_unit_id: first.unit_id, p_source: "booking",
            p_ranges: [
              { uid: "valid-reservation@test", start_date: "2026-10-10", end_date: "2026-10-13" },
              { uid: "time-reservation@test", start_date: "2026-10-14", end_date: "2026-10-17" },
              { uid: "utc-reservation@test", start_date: "2026-10-20", end_date: "2026-10-23" },
              { uid: "floating-reservation@test", start_date: "2026-10-25", end_date: "2026-10-27" },
            ],
          },
        },
        {
          name: "sync_unit_external_blocks",
          body: {
            p_worker_token: WORKER_TOKEN, p_unit_id: second.unit_id, p_source: "airbnb",
            p_ranges: [{ uid: "valid-reservation@test", start_date: "2026-10-10", end_date: "2026-10-13" }],
          },
        },
      ])
      assertEquals(result, {
        units_processed: 2, platforms_ok: 2, platforms_error: 1,
        errors: [{ unit_id: first.unit_id, source: "airbnb", error: "INVALID_ICAL" }],
        totals: { ...zeroTotals, inserted: 2 },
      })
      assertEquals(report, [
        { unit_id: first.unit_id, source: "airbnb", ok: false, error: "INVALID_ICAL" },
        { unit_id: first.unit_id, source: "booking", ok: true, error: null },
        { unit_id: second.unit_id, source: "airbnb", ok: true, error: null },
      ])
    })
  } finally {
    Object.defineProperty(globalThis, "fetch", savedFetch)
    Object.defineProperty(Deno, "serve", savedServe)
    for (const [name, previous] of environment) {
      if (previous === undefined) Deno.env.delete(name)
      else Deno.env.set(name, previous)
    }
  }
})
