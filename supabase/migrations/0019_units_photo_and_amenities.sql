-- ============================================================
-- Operon Reservas — Foto y servicios de cada unidad
-- ============================================================
-- Son datos para el PANEL del propietario, no para la web del huésped:
-- la foto sirve para reconocer la unidad de un vistazo cuando se gestionan
-- varias, y los servicios son dato de consulta operativa ("¿cuál tiene
-- parrilla?", "¿cuál acepta mascotas?").
-- ============================================================

-- Ruta DENTRO del bucket ({org}/{unit}/{ts}.jpg), no la URL completa: si
-- cambia el dominio del proyecto Supabase, las imágenes no se rompen.
alter table units add column if not exists photo_path text;

-- Claves del catálogo de servicios (ver src/lib/amenities.ts). Array nativo
-- y no jsonb: es una lista plana de strings, y así se puede filtrar con
-- los operadores de array (&&, @>) si más adelante hace falta.
alter table units add column if not exists amenities text[] not null default '{}';
