import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { createDemoClient, parseDemoState, DEMO_STATE_COOKIE } from "@/lib/demo/fixtures"
import type { Database } from "./types"

/** Cliente Supabase para Server Components, Server Actions y Route Handlers. */
export async function createClient() {
  const cookieStore = await cookies()

  // El recorrido comercial utiliza el mismo árbol de páginas del producto,
  // pero sus lecturas se resuelven contra fixtures en memoria más lo que
  // ESTE visitante creó (su cookie). Nunca llega a Supabase ni comparte
  // sesión —ni datos— con un usuario real ni con otro visitante.
  if (cookieStore.get("operon_demo")?.value === "1") {
    const state = parseDemoState(cookieStore.get(DEMO_STATE_COOKIE)?.value)
    return createDemoClient(state) as never
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Llamado desde un Server Component: el middleware refresca la sesión.
          }
        },
      },
    }
  )
}
