"use client"

import * as React from "react"
import { GuestInfoDialog } from "@/components/reservations/guest-info-dialog"
import { cn } from "@/lib/utils"

export function GuestNameTrigger({
  guestId,
  children,
  className,
}: {
  guestId: string | null
  children: React.ReactNode
  className?: string
}) {
  if (!guestId) {
    return <span className={className}>{children}</span>
  }

  return (
    <>
      <GuestInfoDialog
        guestId={guestId}
        triggerClassName={cn("print:hidden", className)}
      >
        {children}
      </GuestInfoDialog>
      <span className={cn("hidden print:inline", className)}>{children}</span>
    </>
  )
}
