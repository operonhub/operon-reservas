export const UNIT_PHOTOS_BUCKET = "unit-photos"
export const HOME_BANNER_FILENAME = "home-banner.jpg"

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

/**
 * El banner usa el bucket público existente, pero en una carpeta estable por
 * organización. Las policies del bucket validan el primer segmento (org id),
 * así que un cliente nunca puede reemplazar el banner de otro.
 */
export function homeBannerFolder(organizationId: string): string {
  return `${organizationId}/branding`
}

export function homeBannerPath(organizationId: string): string {
  return `${homeBannerFolder(organizationId)}/${HOME_BANNER_FILENAME}`
}

export function homeBannerUrl(
  organizationId: string,
  version?: string | number | null
): string | null {
  const url = unitPhotoUrl(homeBannerPath(organizationId))
  if (!url || !version) return url
  return `${url}?v=${encodeURIComponent(String(version))}`
}
