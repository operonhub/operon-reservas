"use client"

import * as React from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ImagePlus, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import {
  UNIT_PHOTOS_BUCKET,
  homeBannerPath,
  homeBannerUrl,
} from "@/lib/storage"

const MAX_SIDE = 2400
const QUALITY = 0.84
const MAX_INPUT_BYTES = 15 * 1024 * 1024

async function optimizeBanner(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) return file

  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY)
  )
  return blob ?? file
}

export function HomeBannerField({
  organizationId,
  initialVersion,
}: {
  organizationId: string
  initialVersion?: string | null
}) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [version, setVersion] = React.useState<string | null>(
    initialVersion ?? null
  )
  const [busy, setBusy] = React.useState(false)
  const bannerUrl = version ? homeBannerUrl(organizationId, version) : null

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    if (!file.type.startsWith("image/")) {
      toast.error("El archivo tiene que ser una imagen.")
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast.error("La imagen es demasiado grande (máximo 15 MB).")
      return
    }

    setBusy(true)
    try {
      const blob = await optimizeBanner(file)
      const supabase = createClient()
      const { error } = await supabase.storage
        .from(UNIT_PHOTOS_BUCKET)
        .upload(homeBannerPath(organizationId), blob, {
          cacheControl: "60",
          contentType: "image/jpeg",
          upsert: true,
        })
      if (error) throw error

      setVersion(String(Date.now()))
      toast.success("Banner de inicio actualizado.")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo subir el banner."
      )
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    if (!version) return
    setBusy(true)
    try {
      const { error } = await createClient()
        .storage.from(UNIT_PHOTOS_BUCKET)
        .remove([homeBannerPath(organizationId)])
      if (error) throw error

      setVersion(null)
      toast.success("Se restauró la portada de Operon.")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo quitar el banner."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection
      icon={ImagePlus}
      title="Portada de inicio"
      description="Personalizá la bienvenida del panel con una foto del alojamiento. Si no cargás una, se mantiene la portada editorial de Operon."
      index={4}
    >
      <div className="space-y-3">
        <div className="relative aspect-[16/5] min-h-36 overflow-hidden rounded-xl border bg-muted">
          {bannerUrl ? (
            <>
              <Image
                src={bannerUrl}
                alt="Vista previa del banner de inicio"
                fill
                sizes="(max-width: 1024px) 100vw, 680px"
                className="object-cover"
                unoptimized
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-black/10"
              />
              <p className="label-mono absolute bottom-3 left-3 text-white/85">
                Vista previa
              </p>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-muted-foreground">
              <ImagePlus className="size-7" />
              <span className="font-heading text-sm font-semibold text-foreground">
                Portada Operon activa
              </span>
              <span className="max-w-sm text-xs">
                Podés sumar una foto horizontal cuando quieras.
              </span>
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-background/75">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus /> {bannerUrl ? "Cambiar imagen" : "Subir imagen"}
          </Button>
          {bannerUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 /> Quitar banner
            </Button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onPick}
        />
        <p className="text-xs text-muted-foreground">
          Recomendado: foto horizontal de 2000 × 700 px. Se optimiza a JPEG y
          el cambio se aplica inmediatamente.
        </p>
      </div>
    </SettingsSection>
  )
}
