import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

// Convención `middleware` (estable en Next 16). Refresca sesión y protege el panel.
export async function middleware(request: NextRequest) {
  const isDemoSession = request.cookies.get("operon_demo")?.value === "1"
  const isDemoEntry = request.nextUrl.pathname === "/demo"
  const isLocalDemoWidget =
    ["localhost", "127.0.0.1"].includes(request.nextUrl.hostname) &&
    request.nextUrl.pathname.startsWith("/reservar/") &&
    request.nextUrl.searchParams.get("demo") === "1"

  // Un link demo copiado desde el panel puede abrirse en otra pestaña o en
  // otro navegador local, donde todavía no existe la cookie de la sesión
  // ficticia. Inicializamos esa sesión solo para el slug ficticio y volvemos
  // a la misma URL sin query params.
  if (isLocalDemoWidget) {
    const url = request.nextUrl.clone()
    url.searchParams.delete("demo")
    const response = NextResponse.redirect(url)
    if (!isDemoSession) {
      response.cookies.set("operon_demo", "1", {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
      })
    }
    return response
  }

  // En la publicación comercial no se inicializa Supabase: sólo se expone el
  // acceso ficticio y, una vez activado, las mismas rutas servidas por fixtures.
  if (isDemoEntry || isDemoSession) return NextResponse.next()

  if (process.env.DEMO_ONLY === "1") {
    const url = request.nextUrl.clone()
    url.pathname = "/demo"
    return NextResponse.redirect(url)
  }
  return updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
