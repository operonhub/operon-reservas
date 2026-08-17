import Link from "next/link"
import { PagoStatus } from "@/components/public/pago-status"

export const dynamic = "force-dynamic"

type SP = Promise<{ [key: string]: string | string[] | undefined }>

export default async function PagoPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams
  const code = typeof sp.code === "string" ? sp.code : null
  const org = typeof sp.org === "string" ? sp.org : null

  // Sin code/org no hay nada que verificar contra el backend — pasó algo raro
  // con el link de vuelta de Mercado Pago. No mostramos un estado inventado.
  if (!code || !org) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl">🔎</div>
        <h1 className="mt-4 text-2xl font-semibold">No pudimos verificar tu pago</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Faltan datos en el link. Si venís de pagar, escribile al alojamiento
          contándole cuándo pagaste para que lo confirmen.
        </p>
        <Link
          href="/"
          className="mt-8 text-sm text-muted-foreground underline underline-offset-4"
        >
          Volver
        </Link>
      </main>
    )
  }

  return <PagoStatus code={code} orgSlug={org} />
}
