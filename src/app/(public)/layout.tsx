/**
 * Web pública del huésped.
 *
 * `operon-light` fuerza los tokens claros: el dueño del alojamiento puede
 * tener el panel en modo oscuro (next-themes escribe `.dark` en <html>) y la
 * vidriera de reservas lo heredaría. Es una vidriera de venta, no una
 * herramienta de trabajo — se ve igual para todos los huéspedes.
 *
 * Regla al escribir markup acá: NO usar utilidades `dark:` (siguen
 * resolviendo por ser descendientes de `.dark`). Para el logo, usar las
 * variantes fijas (`OperonMarkTinta`), no el `OperonMark` con swap.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="operon-light min-h-screen bg-background text-foreground">
      {children}
    </div>
  )
}
