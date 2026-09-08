import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

// Convención `middleware` (estable en Next 16). Refresca sesión y protege el panel.
export async function middleware(request: NextRequest) {
  const isDemoSession = request.cookies.get("operon_demo")?.value === "1"
  const isDemoEntry = request.nextUrl.pathname === "/demo"

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
