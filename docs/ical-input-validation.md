# Lectura segura de calendarios externos

El worker `sync-external-calendars` usa el calendario completo para informar
ocupación y ausencias a `sync_unit_external_blocks`. Omitir un evento que no pudo
leer puede marcar una reserva vigente como desaparecida; si todos los eventos
fallan, puede incluso confundir esa respuesta con un calendario vacío.

## Decisión

El calendario de cada unidad y plataforma se acepta completo o se rechaza. Un
solo evento incompleto, una estructura cortada o una representación que no se
puede convertir a rangos confiables produce `INVALID_ICAL`, sin llamar al RPC de
sincronización de ese calendario. Así no se agregan ausencias ni avanzan sus
contadores por una lectura parcial. Los demás calendarios del lote continúan.

El reporte existente guarda sólo el código de error, nunca contenido, UID ni
links de los calendarios. El panel de Operon explica que se conservaron las
fechas anteriores. La tabla de estado ya admite este código: no requiere una
migración.

## Formatos admitidos

- Un `VCALENDAR` completo, con `VEVENT` que tengan un único `UID`, `DTSTART` y
  `DTEND`, fechas reales y fin posterior al inicio en días de alojamiento.
- `DATE` (`20261010`) y `DATE-TIME` (`20261010T150000`, con o sin `Z` o parámetro
  `TZID`). Se conserva el día publicado, como en el comportamiento anterior;
  no se convierte entre zonas horarias.
- Nombres de componentes y propiedades sin distinción de mayúsculas, líneas
  plegadas, saltos CRLF/LF/CR y BOM inicial.
- `VTIMEZONE` con `STANDARD`/`DAYLIGHT`, y `VALARM` dentro de un evento. Sus
  propiedades no reemplazan las fechas ni el UID de la reserva.
- Propiedades adicionales de texto o metadata, incluidas `X-*`.
- Una repetición idéntica de UID y fechas se deduplica; el mismo UID con fechas
  distintas se rechaza, porque la base sólo conserva un rango por UID.

Los componentes desconocidos o en una posición incorrecta se rechazan. Tampoco
se expanden recurrencias ni duraciones de eventos: `RRULE`, `RDATE`, `EXDATE`,
`EXRULE`, `RECURRENCE-ID` o `DURATION` dentro de un `VEVENT` hacen fallar la
lectura. Algunos de estos formatos son válidos según iCalendar, pero no están
soportados por este sincronizador. Las reglas horarias dentro de `VTIMEZONE`
siguen permitidas.

Un calendario completo y sin eventos continúa enviando `p_allow_empty: true`.
Esto habilita el tratamiento de ausencias en la base; no prueba una cancelación
ni evita los márgenes y esperas de las migraciones 0043–0045.

## Verificación local

```sh
npm run test:functions
deno check --node-modules-dir=none --no-lock supabase/functions/sync-external-calendars/index.ts
node --test tests/db/ical-sync-por-dias.test.mjs tests/db/salud-ical.test.mjs tests/db/ical-sin-eco.test.mjs
```

La prueba `index.test.ts` ejecuta el handler real con HTTP simulado y calendarios
sintéticos. Verifica cero llamadas de sincronización para los calendarios
rechazados, reporte seguro, compatibilidad y continuidad del lote. Los tests de
base ejecutan las migraciones en PGlite local; no acceden a Supabase remoto.

## Límites operativos

El rechazo completo también demora nuevas reservas o cambios correctos que
vinieran en ese mismo calendario. La ocupación previa queda conservada hasta
una lectura interpretable; el operador debe revisar el error si persiste.

Esta protección detecta datos incompletos o no interpretables. No puede detectar
una reserva que la plataforma simplemente omite de un calendario bien formado:
para eso siguen vigentes las protecciones de ausencias y desapariciones masivas
de la base. La verificación local no confirma qué versión está desplegada en
Supabase ni cómo responden los calendarios reales de clientes.
