"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, Copy, ExternalLink } from "lucide-react"
import { markLinkShared } from "@/app/(panel)/onboarding-actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Copia el link público y lo cuenta como compartido en la lista de primeros pasos. */
export function useCopyPublicLink(url: string) {
  const [copied, setCopied] = React.useState(false)

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      toast.error("No se pudo copiar. Abrí el link y copialo desde la barra del navegador.")
      return false
    }
    setCopied(true)
    toast.success("Link copiado. Ya lo podés pegar en WhatsApp o Instagram.")
    void markLinkShared()
    setTimeout(() => setCopied(false), 2000)
    return true
  }, [url])

  return { copied, copy }
}

export function ShareLink({ url }: { url: string }) {
  const { copied, copy } = useCopyPublicLink(url)

  return (
    <div data-tour="link" className="mb-3 rounded-lg border bg-card/70 p-2.5">
      <p className="label-mono text-muted-foreground">Tu link de reservas</p>
      <p className="mt-1 truncate font-mono text-xs" title={url}>
        {url.replace(/^https?:\/\//, "")}
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copiado" : "Copiar link"}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir tu página de reservas"
          title="Abrir tu página de reservas"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground")}
        >
          <ExternalLink />
        </a>
      </div>
    </div>
  )
}
