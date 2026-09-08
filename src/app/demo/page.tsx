import type { Metadata } from "next"
import { DemoAccess } from "@/components/demo/demo-access"

export const metadata: Metadata = {
  title: "Demo comercial · Operon Reservas",
  description: "Recorrido interactivo simulado de Operon Reservas.",
  robots: { index: false, follow: false },
}

export default function DemoPage() {
  return <DemoAccess />
}
