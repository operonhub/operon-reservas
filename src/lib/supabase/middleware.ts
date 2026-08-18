import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import type { Database } from "./types"

/**
 * Refresca la sesión de Supabase en cada request y protege el panel.
 * Sin sesión válida -> redirige a /login (excepto /login, la API pública y assets).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  // Rutas sin sesión: login, API pública y la web pública de reservas de cada cabaña.
  // Cobros MP: checkout (huésped anónimo / landing externa), webhook (servidores
  // de MP) y la página de retorno del pago. connect/callback SÍ requieren sesión.
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/public") ||
    pathname.startsWith("/reservar") ||
    pathname.startsWith("/api/mp/checkout") ||
    pathname.startsWith("/api/mp/webhook") ||
    pathname.startsWith("/pago") ||
    pathname.startsWith("/ical")

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
