/**
 * Interruptor único de "Tu zona este mes": sin `ZONE_MONTH_ENABLED=1` no hay
 * generación (cron), ni página, ni link en el menú. Solo se lee en el
 * servidor — la variable no lleva NEXT_PUBLIC_ a propósito.
 */
export function isZoneMonthEnabled() {
  return process.env.ZONE_MONTH_ENABLED === "1"
}
