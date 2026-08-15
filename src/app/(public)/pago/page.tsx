import Link from "next/link"

export const dynamic = "force-dynamic"

type SP = Promise<{ [key: string]: string | string[] | undefined }>

const OUTCOMES: Record<
  string,
  { emoji: string; title: string; message: string }
> = {
  approved: {
    emoji: "✅",
    title: "¡Pago recibido!",
    message:
      "Tu seña se acreditó y tu reserva quedó confirmada. Te llegará el detalle por email.",
  },
  pending: {
    emoji: "⏳",
    title: "Pago en proceso",
    message:
      "Mercado Pago está procesando tu pago. En cuanto se acredite, tu reserva se confirma automáticamente.",
  },
  in_process: {
    emoji: "⏳",
    title: "Pago en proceso",
    message:
      "Mercado Pago está procesando tu pago. En cuanto se acredite, tu reserva se confirma automáticamente.",
  },
  rejected: {
    emoji: "❌",
    title: "El pago no se completó",
    message:
      "No se pudo procesar el pago. Podés intentar de nuevo desde tu reserva.",
  },
  failure: {
    emoji: "❌",
    title: "El pago no se completó",
    message:
      "No se pudo procesar el pago. Podés intentar de nuevo desde tu reserva.",
  },
}

export default async function PagoPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams
  const status = String(
    sp.status ?? sp.collection_status ?? "pending"
  ).toLowerCase()
  const code = typeof sp.code === "string" ? sp.code : null
  const outcome = OUTCOMES[status] ?? OUTCOMES.pending

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl">{outcome.emoji}</div>
      <h1 className="mt-4 text-2xl font-semibold">{outcome.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{outcome.message}</p>
      {code && (
        <p className="mt-6 rounded-lg bg-muted px-4 py-2 font-mono text-lg font-semibold">
          {code}
        </p>
      )}
      <Link
        href="/"
        className="mt-8 text-sm text-muted-foreground underline underline-offset-4"
      >
        Volver
      </Link>
    </main>
  )
}
