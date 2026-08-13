import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

// Convención `middleware` (estable en Next 16). Refresca sesión y protege el panel.
export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
