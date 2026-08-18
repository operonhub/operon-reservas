"use client"

import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"

/**
 * Abre el diálogo de impresión del navegador, donde "Guardar como PDF" ya
 * viene incluido. Se apoya en los estilos `@media print` de globals.css:
 * no hace falta ninguna librería de PDF ni generarlo en el servidor.
 */
export function PrintButton({ label = "Imprimir / PDF" }: { label?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  )
}
