import { cookies } from "next/headers"
import {
  DEMO_STATE_COOKIE,
  parseDemoState,
  serializeDemoState,
  type DemoState,
} from "@/lib/demo/fixtures"

/** ¿La request viene del recorrido de demostración? */
export async function isDemoRequest(): Promise<boolean> {
  return (await cookies()).get("operon_demo")?.value === "1"
}

/** El estado de demo de este visitante (lo que creó/cambió en su cookie). */
export async function readDemoState(): Promise<DemoState> {
  return parseDemoState((await cookies()).get(DEMO_STATE_COOKIE)?.value)
}

/**
 * Persiste el estado del visitante en su cookie. Sólo se puede llamar desde
 * una Server Action o un Route Handler (un Server Component no puede escribir
 * cookies). Vive junto a `operon_demo`, sin fecha de expiración: se borra al
 * salir de la demo.
 */
export async function writeDemoState(state: DemoState): Promise<void> {
  ;(await cookies()).set(DEMO_STATE_COOKIE, serializeDemoState(state), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  })
}

/** Borra el estado de demo (al cerrar sesión de la demo). */
export async function clearDemoState(): Promise<void> {
  ;(await cookies()).delete(DEMO_STATE_COOKIE)
}
