import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { createDemoClient } from "@/lib/demo/fixtures"
import type { Database } from "./types"

/** Cliente Supabase para Server Components, Server Actions y Route Handlers. */
export async function createClient() {
  const cookieStore = await cookies()

  // El recorrido comercial utiliza el mismo árbol de páginas del producto,
  // pero sus lecturas se resuelven contra fixtures en memoria. Nunca llega a
  // Supabase ni comparte sesión con un usuario real.
  if (cookieStore.get("operon_demo")?.value === "1") {
    return createDemoClient() as never
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
