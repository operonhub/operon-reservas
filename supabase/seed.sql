-- ============================================================
-- Operon Reservas — SEED demo (ficticio, idempotente)
-- ============================================================
-- Dos organizaciones para validar aislamiento multi-tenant:
--   A) Operon Demo Cabins  → Cabañas del Beagle (3 unidades)
--   B) Sierra Retreat      → Sierra Lodge      (1 unidad)
-- Admins (password dev: Reservas2026!):
--   admin@demo-cabins.dev  → org A (owner)
--   admin@sierra.dev       → org B (owner)
-- ============================================================

-- ---------- Usuarios admin en auth.users ----------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) values
(
  '00000000-0000-0000-0000-000000000000',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'authenticated','authenticated','admin@demo-cabins.dev',
  crypt('Reservas2026!', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Admin Demo Cabins"}'::jsonb,
  '', '', '', '', '', '', '', ''
),
(
  '00000000-0000-0000-0000-000000000000',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'authenticated','authenticated','admin@sierra.dev',
  crypt('Reservas2026!', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Admin Sierra"}'::jsonb,
  '', '', '', '', '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
) values
(
  gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","email":"admin@demo-cabins.dev","email_verified":true}'::jsonb,
  'email','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), now(), now()
),
(
  gen_random_uuid(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","email":"admin@sierra.dev","email_verified":true}'::jsonb,
  'email','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', now(), now(), now()
)
on conflict do nothing;

-- ---------- Datos de negocio (idempotente) ----------
truncate payments, unit_occupancy, reservations, guests, rates,
         units, properties, memberships, organizations restart identity cascade;

-- Organizaciones (tenants)
insert into organizations (id, name, slug) values
('10000000-0000-0000-0000-000000000001','Operon Demo Cabins','operon-demo-cabins'),
('10000000-0000-0000-0000-000000000002','Sierra Retreat','sierra-retreat');

-- Memberships (acceso usuario ↔ org)
insert into memberships (organization_id, user_id, role) values
('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','owner'),
('10000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','owner');

-- Properties
insert into properties (id, organization_id, name, slug, description, phone, whatsapp, email, city, currency, deposit_pct) values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
 'Cabañas del Beagle','cabanas-del-beagle','Cabañas de montaña con vista al lago','+54 9 351 555 0001','+54 9 351 555 0001','hola@cabanasdelbeagle.com','Villa Ventana','ARS',30),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
 'Sierra Lodge','sierra-lodge','Domos y refugios en la sierra','+54 9 351 555 0002','+54 9 351 555 0002','hola@sierraretreat.com','Los Reartes','ARS',30);

-- Units
insert into units (id, organization_id, property_id, name, description, capacity, position) values
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Cabaña 1','2 ambientes, hasta 4 personas',4,1),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Cabaña 2','2 ambientes, hasta 4 personas',4,2),
('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Loft','Monoambiente para 2',2,3),
('30000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Domo Estelar','Domo geodésico para 2',2,1);

-- Rates (base property-wide por org)
insert into rates (organization_id, property_id, unit_id, kind, price_per_night, currency, min_nights) values
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null,'base',90000,'ARS',2),
('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',null,'base',70000,'ARS',1);
-- Tarifa específica del Loft (más barato)
insert into rates (organization_id, property_id, unit_id, kind, price_per_night, currency, min_nights) values
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','base',60000,'ARS',2);
