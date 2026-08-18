-- ============================================================
-- Operon Reservas — Reglas de tarifa dinámicas
-- ============================================================
-- Se extiende `rates` en lugar de crear una tabla nueva: una tarifa sigue
-- siendo "un precio con condiciones", sólo que ahora las condiciones son
-- más ricas (días de la semana, cantidad de huéspedes, largo de estadía) y
-- el efecto puede ser un precio fijo o un descuento porcentual.
--
-- `kind` NO se toca (base/seasonal/special): los tipos que ve el propietario
-- ("Fin de semana", "Exclusivo parejas"…) son presets de la interfaz que
-- rellenan estas columnas. Ver src/lib/rate-rules.ts.
-- ============================================================

-- Nombre legible. Hoy las tarifas no tienen nombre y en la lista son
-- indistinguibles entre sí.
alter table rates add column if not exists label text;

-- Días en que aplica, 0=domingo … 6=sábado. NULL = todos los días.
alter table rates add column if not exists weekdays smallint[];

-- Descuento sobre la tarifa base, como alternativa a fijar un precio.
alter table rates add column if not exists discount_pct numeric(5,2);

-- Condición por tamaño del grupo (el "exclusivo parejas").
alter table rates add column if not exists min_guests int;
alter table rates add column if not exists max_guests int;

-- Noches mínimas para que la REGLA aplique (descuento por estadía larga).
-- Ojo, no confundir con `min_nights`, que es el mínimo EXIGIDO para poder
-- reservar: uno habilita un beneficio, el otro bloquea la reserva.
alter table rates add column if not exists min_nights_rule int;

-- Permite apagar una promo sin perder su configuración.
alter table rates add column if not exists is_active boolean not null default true;

-- El check original (0001) exigía fechas a TODA tarifa que no fuera base:
--   check (kind = 'base' or (start_date is not null and end_date is not null))
-- Eso impide las reglas que aplican siempre, sin rango — "fin de semana",
-- "estadía larga", "exclusivo parejas". Se reemplaza por uno que sólo pide
-- coherencia entre las fechas cuando están presentes.
alter table rates drop constraint if exists rates_check;
alter table rates drop constraint if exists rates_dates_chk;
alter table rates add constraint rates_dates_chk check (
  (start_date is null and end_date is null)
  or (start_date is not null and end_date is not null and start_date <= end_date)
);

-- Una regla de descuento no fija precio, así que el precio deja de ser
-- obligatorio…
alter table rates alter column price_per_night drop not null;

-- …pero una tarifa tiene que hacer UNA de las dos cosas, nunca ambas ni
-- ninguna. La base 'base' siempre lleva precio: es el piso sobre el que se
-- calculan los descuentos.
alter table rates drop constraint if exists rates_price_or_discount_chk;
alter table rates add constraint rates_price_or_discount_chk check (
  (kind = 'base' and price_per_night is not null and discount_pct is null)
  or (kind <> 'base' and num_nonnulls(price_per_night, discount_pct) = 1)
);

alter table rates drop constraint if exists rates_discount_range_chk;
alter table rates add constraint rates_discount_range_chk check (
  discount_pct is null or (discount_pct > 0 and discount_pct <= 100)
);

alter table rates drop constraint if exists rates_guests_range_chk;
alter table rates add constraint rates_guests_range_chk check (
  min_guests is null or max_guests is null or min_guests <= max_guests
);

-- Los días tienen que ser 0..6 y sin repetidos.
alter table rates drop constraint if exists rates_weekdays_chk;
alter table rates add constraint rates_weekdays_chk check (
  weekdays is null
  or (
    array_length(weekdays, 1) between 1 and 7
    and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  )
);

-- El motor resuelve noche por noche filtrando por unidad + fecha; sin índice
-- son N escaneos de la tabla por estadía.
create index if not exists rates_lookup_idx
  on rates (organization_id, property_id, unit_id)
  where is_active;
