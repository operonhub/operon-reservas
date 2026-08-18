-- ============================================================
-- Operon Reservas — Bucket de fotos de unidades
-- ============================================================
-- Convención de ruta: {organization_id}/{unit_id}/{timestamp}.{ext}
-- El PRIMER segmento es el organization_id, y de ahí cuelga todo el
-- aislamiento entre tenants: las políticas de escritura comparan ese
-- segmento contra is_member_of() (0002_rls.sql).
--
-- DECISIÓN CONSCIENTE: el bucket es de LECTURA PÚBLICA. Las fotos de
-- cabañas no son información sensible (los propietarios ya las publican en
-- sus propias webs) y evitar las signed URLs simplifica todo el renderizado
-- —no hay que firmar cada imagen en cada render ni manejar su expiración.
-- La ESCRITURA sí está acotada por organización.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'unit-photos',
  'unit-photos',
  true,
  5242880, -- 5 MB; el cliente además redimensiona antes de subir
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura: pública (el bucket ya lo es; la policy lo hace explícito).
drop policy if exists "unit_photos_read" on storage.objects;
create policy "unit_photos_read" on storage.objects
  for select
  using ( bucket_id = 'unit-photos' );

-- Escritura: sólo miembros de la organización dueña de la carpeta.
-- storage.foldername() devuelve los segmentos del path; el [1] es la org.
drop policy if exists "unit_photos_insert" on storage.objects;
create policy "unit_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'unit-photos'
    and public.is_member_of(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "unit_photos_update" on storage.objects;
create policy "unit_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'unit-photos'
    and public.is_member_of(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "unit_photos_delete" on storage.objects;
create policy "unit_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'unit-photos'
    and public.is_member_of(((storage.foldername(name))[1])::uuid)
  );
