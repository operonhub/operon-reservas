"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, Copy, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { relative } from "@/lib/operon/format"
import { WEBSITE_STATUS, type Tone, type WebsiteStatus } from "@/lib/operon/website"
import { cn } from "@/lib/utils"
import { saveWebsite, verifyWebsite, type WebsiteState } from "./actions"

const TONES: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/30 text-warning-foreground",
  danger: "bg-destructive/15 text-destructive",
  muted: "bg-muted text-muted-foreground",
}

/**
 * La web del cliente y su widget: cargar la dirección, verificar si el widget
 * está puesto (y es el de este complejo) y copiar el código ya completado.
 */
export function WebsiteCard({
  orgId,
  slug,
  url,
  status,
  note,
  checkedAt,
  snippet,
  whatsappOk,
  suspended,
  now,
}: {
  orgId: string
  slug: string
  url: string | null
  status: string | null
  note: string | null
  checkedAt: string | null
  snippet: string
  whatsappOk: boolean
  suspended: boolean
  now: number
}) {
  const info = status && status in WEBSITE_STATUS ? WEBSITE_STATUS[status as WebsiteStatus] : null

  const [, saveAction, saving] = React.useActionState<WebsiteState, FormData>(async (prev, formData) => {
    const result = await saveWebsite(prev, formData)
    if (result?.error) toast.error(result.error)
    else if (result?.message) toast.success(result.message)
    return result
  }, null)
  const [, verifyAction, verifying] = React.useActionState<WebsiteState, FormData>(async (prev, formData) => {
    const result = await verifyWebsite(prev, formData)
    if (result?.error) toast.error(result.error)
    else if (result?.message) toast.success(result.message)
    return result
  }, null)

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        {info ? (
          <span className={cn("label-mono rounded-md px-2 py-1", TONES[info.tone])}>{info.label}</span>
        ) : (
          <span className={cn("label-mono rounded-md px-2 py-1", TONES.muted)}>{url ? "Sin verificar" : "Sin web cargada"}</span>
        )}
        {checkedAt && <span className="text-xs text-muted-foreground">Verificada {relative(checkedAt, now)}</span>}
      </div>
      {info && <p className="-mt-2 text-muted-foreground">{info.hint}</p>}
      {note && <p className="rounded-lg bg-warning/20 p-2.5 text-xs">{note}</p>}

      <form action={saveAction} className="space-y-1.5">
        <label htmlFor="website-url" className="label-mono text-muted-foreground">
          Página de su web donde está el widget
        </label>
        <div className="flex flex-wrap gap-2">
          <input type="hidden" name="org" value={orgId} />
          <Input
            id="website-url"
            name="url"
            type="text"
            inputMode="url"
            defaultValue={url ?? ""}
            key={url ?? "vacia"}
            placeholder="https://sucomplejo.com.ar"
            autoComplete="off"
            className="min-w-[16rem] flex-1"
          />
          <Button type="submit" variant="outline" disabled={saving}>
            {saving && <LoaderCircle className="animate-spin" />}
            Guardar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Si el widget está en otra página (por ejemplo /reservas), poné esa dirección exacta.
        </p>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <form action={verifyAction}>
          <input type="hidden" name="org" value={orgId} />
          <Button type="submit" disabled={!url || verifying}>
            {verifying ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {verifying ? "Verificando…" : "Verificar ahora"}
          </Button>
        </form>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Abrir su web <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      {suspended && (
        <p className="text-xs text-muted-foreground">
          Complejo suspendido: aunque el widget esté puesto, la página de reservas no acepta reservas nuevas.
        </p>
      )}

      <div className="border-t pt-4">
        <p className="label-mono text-muted-foreground">Código del widget</p>
        <p className="mt-1 text-muted-foreground">
          Ya viene con el slug <code className="font-mono text-xs">{slug}</code>
          {whatsappOk ? " y el WhatsApp del complejo." : ". Falta el WhatsApp: el complejo no lo cargó en Configuración, completá WA_NUMBER a mano."}
          {" "}Pegalo en la sección donde van las reservas de su web.
        </p>
        <SnippetCopy snippet={snippet} />
      </div>
    </div>
  )
}

function SnippetCopy({ snippet }: { snippet: string }) {
  const [copied, setCopied] = React.useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet)
    } catch {
      toast.error("No se pudo copiar. Abrí el código y copialo a mano.")
      return
    }
    setCopied(true)
    toast.success("Código copiado. Pegalo en la web del cliente.")
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="mt-3 space-y-2">
      <Button type="button" variant="outline" onClick={copy}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copiado" : "Copiar código del widget"}
      </Button>
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">Ver el código</summary>
        <textarea
          readOnly
          value={snippet}
          aria-label="Código del widget"
          rows={10}
          className="w-full resize-y border-t bg-muted/40 p-3 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
      </details>
    </div>
  )
}
