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
  icalToken,
  airbnbUrl,
  bookingUrl,
}: {
  unitId: string
  icalToken: string
  airbnbUrl: string | null
  bookingUrl: string | null
}) {
  return (
    <div className="grid gap-3">
      <Separator />
      <div>
        <p className="text-sm font-medium">Sincronización con Airbnb/Booking</p>
        <p className="text-xs text-muted-foreground">
          Pegá acá la URL que te da Airbnb/Booking (o Google Calendar, VRBO…)
          al exportar tu calendario desde su panel. Sirve cualquier dirección
          <code className="mx-1 rounded bg-muted px-1">https://</code> o
          <code className="mx-1 rounded bg-muted px-1">webcal://</code>.
          Actualizamos las fechas ocupadas cada una hora. Para protección
          completa, copiá también el link de calendario de esta unidad (abajo)
          y pegalo en la sección de &quot;importar calendario&quot; de cada
          plataforma.
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          <strong>Ojo con cruzar unidades:</strong> el link de cada cabaña de
          Booking va en la misma cabaña acá. El panel no compara nombres: toma
          como ocupadas las fechas del link que pegues.
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

      <div className="grid gap-2 rounded-lg border border-dashed p-2.5">
        <p className="text-xs text-muted-foreground">
          Link de calendario de esta unidad. Cada plataforma tiene el suyo:
          pegá en Booking el de Booking y en Airbnb el de Airbnb.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <CopyIcalLink unitId={unitId} token={icalToken} canal="booking" />
          <CopyIcalLink unitId={unitId} token={icalToken} canal="airbnb" />
        </div>
      </div>
    </div>
  )
}
