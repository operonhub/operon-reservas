import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { CopyIcalLink } from "@/components/units/copy-ical-link"

/**
 * Configuración de sincronización de calendarios externos: las URLs que el
 * dueño pega desde Airbnb/Booking (las leemos nosotros, cada hora) y el link
 * de export propio de la unidad (se lo pegan ELLOS a nosotros).
 */
export function IcalSyncFields({
  unitId,
  airbnbUrl,
  bookingUrl,
}: {
  unitId: string
  airbnbUrl: string | null
  bookingUrl: string | null
}) {
  return (
    <div className="grid gap-3">
      <Separator />
      <div>
        <p className="text-sm font-medium">Sincronización con Airbnb/Booking</p>
        <p className="text-xs text-muted-foreground">
          Pegá acá la URL que te da Airbnb/Booking al exportar tu calendario
          desde su panel. Actualizamos las fechas ocupadas cada una hora. Para
          protección completa, copiá también el link de calendario de esta
          unidad (abajo) y pegalo en la sección de &quot;importar
          calendario&quot; de Airbnb y Booking.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="airbnb_ical_url">Calendario de Airbnb (iCal)</Label>
        <Input
          id="airbnb_ical_url"
          name="airbnb_ical_url"
          type="url"
          defaultValue={airbnbUrl ?? ""}
          placeholder="https://www.airbnb.com/calendar/ical/..."
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="booking_ical_url">Calendario de Booking.com (iCal)</Label>
        <Input
          id="booking_ical_url"
          name="booking_ical_url"
          type="url"
          defaultValue={bookingUrl ?? ""}
          placeholder="https://admin.booking.com/.../ical"
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-dashed p-2.5">
        <p className="text-xs text-muted-foreground">
          Link de calendario de esta unidad (para pegar en Airbnb/Booking)
        </p>
        <CopyIcalLink unitId={unitId} />
      </div>
    </div>
  )
}
