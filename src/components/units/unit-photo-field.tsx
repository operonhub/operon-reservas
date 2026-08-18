"use client"

import * as React from "react"
import Image from "next/image"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { UNIT_PHOTOS_BUCKET, unitPhotoPath, unitPhotoUrl } from "@/lib/storage"
import { ImagePlus, Trash2, Loader2 } from "lucide-react"

const MAX_SIDE = 1600
const QUALITY = 0.82
const MAX_INPUT_BYTES = 15 * 1024 * 1024

/**
 * Reduce la foto ANTES de subirla.
 *
 * Una foto de celular pesa 6-9 MB y la tarjeta del grid la muestra a ~400px:
 * guardar el original haría que la grilla descargue decenas de MB. Se
 * redibuja en un canvas al lado mayor de 1600px y se recomprime a JPEG.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY)
  )
  return blob ?? file
}

export function UnitPhotoField({
  organizationId,
  unitId,
  initialPath,
}: {
  organizationId: string
  unitId?: string
  initialPath?: string | null
}) {
  const [path, setPath] = React.useState<string | null>(initialPath ?? null)
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // Al crear todavía no hay unitId; se usa un id de borrador sólo para
  // agrupar el archivo en una carpeta. El aislamiento entre organizaciones
  // depende del PRIMER segmento del path, no de este.
  const folderId = React.useRef(unitId ?? crypto.randomUUID())

  const url = unitPhotoUrl(path)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // permite volver a elegir el mismo archivo
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
      const blob = await shrink(file)
      const supabase = createClient()
      const dest = unitPhotoPath(organizationId, folderId.current)

      const { error } = await supabase.storage
        .from(UNIT_PHOTOS_BUCKET)
        .upload(dest, blob, { contentType: "image/jpeg", upsert: false })
      if (error) throw error

      // La anterior queda huérfana si no se limpia.
      if (path) {
        await supabase.storage.from(UNIT_PHOTOS_BUCKET).remove([path])
      }
      setPath(dest)
      toast.success("Foto actualizada.")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo subir la imagen."
      )
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    if (!path) return
    setBusy(true)
    try {
      await createClient().storage.from(UNIT_PHOTOS_BUCKET).remove([path])
      setPath(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-1.5">
      <Label>Foto</Label>
      {/* Viaja en el FormData que ya usan las server actions. */}
      <input type="hidden" name="photo_path" value={path ?? ""} />

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border bg-muted">
        {url ? (
          <Image
            src={url}
            alt=""
            fill
            sizes="320px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImagePlus className="size-7" />
            <span className="label-mono">Sin foto</span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-background/70">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus /> {url ? "Cambiar" : "Subir foto"}
        </Button>
        {url && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onRemove}
            aria-label="Quitar foto"
          >
            <Trash2 />
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
      <p className="text-[11px] text-muted-foreground">
        Se recorta a 4:3 y se optimiza automáticamente.
      </p>
    </div>
  )
}
