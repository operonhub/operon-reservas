"use client"

import { useRouter } from "next/navigation"
import { ArrowRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function DemoAccess() {
  const router = useRouter()
  function enter() {
    document.cookie = "operon_demo=1; Path=/; SameSite=Lax"
    router.replace("/")
    router.refresh()
  }
  return <main className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_0.95fr]"><section className="relative hidden overflow-hidden bg-foreground p-12 text-background lg:flex lg:flex-col lg:justify-between"><div className="absolute -right-24 -bottom-28 size-[32rem] rounded-full border-[68px] border-warning/20" /><div className="relative text-lg font-heading font-semibold">Operon <span className="label-mono ml-2 text-background/55">Reservas</span></div><div className="relative max-w-xl"><p className="label-mono text-warning">Demostración comercial</p><h1 className="mt-5 font-heading text-6xl leading-[0.92] font-semibold tracking-[-0.06em]">Tu alojamiento, bajo control.</h1><p className="mt-6 max-w-md text-lg leading-7 text-background/70">Entrá al producto real con un alojamiento, unidades y reservas exclusivamente ficticios.</p></div><p className="relative label-mono text-background/45">Sin conexión con cuentas, reservas ni pagos reales</p></section><section className="flex items-center justify-center p-5 sm:p-8"><div className="w-full max-w-md"><p className="label-mono text-primary">Acceso de demostración</p><h1 className="mt-2 font-heading text-4xl font-semibold tracking-[-0.05em]">Conocé el sistema.</h1><p className="mt-3 leading-6 text-muted-foreground">Esta entrada activa el mismo panel, navegación y componentes del producto, conectado a fixtures locales.</p><div className="mt-8 rounded-2xl border bg-card p-5 shadow-lg shadow-foreground/5"><div className="rounded-xl bg-warning/15 px-3 py-2.5 text-xs leading-5"><Sparkles className="mr-1.5 inline size-3.5" />Acceso ficticio: no solicita ni verifica credenciales reales.</div><div className="mt-5"><Label htmlFor="demo-profile">Perfil de prueba</Label><Input id="demo-profile" className="mt-1.5" value="demo@operon.app" readOnly /></div><Button className="mt-5 w-full" onClick={enter}>Ingresar a la demostración <ArrowRight /></Button><p className="mt-4 text-center text-xs text-muted-foreground">El modo demo se identifica durante todo el recorrido.</p></div></div></section></main>
}
