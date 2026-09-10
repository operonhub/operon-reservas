import { Eye } from "lucide-react"
import { SETTINGS_READ_ONLY_MESSAGE } from "@/lib/roles"

/** Aviso para 'staff' en las secciones que puede ver pero no cambiar. */
export function ReadOnlyNotice() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <Eye className="mt-0.5 size-4 shrink-0" />
      {SETTINGS_READ_ONLY_MESSAGE}
    </p>
  )
}
