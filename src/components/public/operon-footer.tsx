import { OperonMarkTinta } from "@/components/brand/operon-mark"

/**
 * Firma de Operon en las páginas que ve el huésped.
 *
 * Regla interna de marca: chica, sutil y en baja opacidad — no debe competir
 * con el branding del alojamiento, que es el dueño de esta página.
 * Usa la variante fija (tinta) porque la web pública es siempre clara.
 */
export function OperonFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`flex justify-center py-8 ${className}`}>
      <a
        href="https://operonhub.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="label-mono inline-flex items-center gap-1.5 text-muted-foreground opacity-60 transition-opacity hover:opacity-100"
      >
        <OperonMarkTinta className="h-4 w-3" />
        Reservas con Operon
      </a>
    </footer>
  )
}
