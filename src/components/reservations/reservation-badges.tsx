import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  RESERVATION_STATUS_LABELS,
  RESERVATION_SOURCE_LABELS,
} from "@/lib/constants"
import type { Enums } from "@/lib/supabase/types"

const STATUS_CLASS: Record<Enums<"reservation_status">, string> = {
  inquiry: "bg-muted text-muted-foreground",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending_payment: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  completed: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  cancelled: "bg-destructive/10 text-destructive line-through",
}

export function StatusBadge({ status }: { status: Enums<"reservation_status"> }) {
  return (
    <Badge className={cn("border-transparent", STATUS_CLASS[status])}>
      {RESERVATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: Enums<"reservation_source"> }) {
  return <Badge variant="outline">{RESERVATION_SOURCE_LABELS[source]}</Badge>
}
