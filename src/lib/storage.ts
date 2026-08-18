export const UNIT_PHOTOS_BUCKET = "unit-photos"

/**
 * URL pública de una foto de unidad a partir de su ruta en el bucket.
 *
 * Se guarda la ruta y no la URL (ver 0015): armarla acá deja un solo lugar
 * que depende del dominio del proyecto Supabase.
 */
export function unitPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base}/storage/v1/object/public/${UNIT_PHOTOS_BUCKET}/${path}`
}

/** Ruta destino de una foto: el primer segmento es la org (ver 0016). */
export function unitPhotoPath(
  organizationId: string,
  unitId: string,
  ext = "jpg"
): string {
  return `${organizationId}/${unitId}/${Date.now()}.${ext}`
}
