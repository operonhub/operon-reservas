-- ============================================================
-- Operon Reservas — Esquema núcleo multi-tenant (Etapa 1)
-- ============================================================
-- Cada fila lleva organization_id. El aislamiento se hace por fila
-- (RLS en 0002), no solo por join. La disponibilidad tiene UNA sola
-- fuente de verdad: unit_occupancy (0003).
-- ============================================================
create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";  -- necesario para EXCLUDE anti-solape

-- ---------- Enums ----------
create type membership_role    as enum ('owner','admin','staff');
create type reservation_status as enum ('inquiry','pending','pending_payment','confirmed','completed','cancelled');
create type reservation_source as enum ('direct','manual','booking','airbnb','whatsapp','other');
create type occupancy_kind     as enum ('reservation','block');
create type payment_kind       as enum ('deposit','balance','refund','other');
create type payment_status     as enum ('pending','paid','failed','refunded');
create type rate_kind          as enum ('base','seasonal','special');

-- ============================================================
-- IDENTIDAD Y TENANCY
-- ============================================================

-- profiles: fila de display por cada usuario de auth (NO otorga acceso).
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- organizations: el TENANT = la cabaña como negocio.
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,           -- identifica SOLO contenido público
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- memberships: única fuente de acceso usuario ↔ organización.
-- El organization_id de un usuario JAMÁS viene del frontend: se deriva de acá.
create table memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            membership_role not null default 'admin',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_idx on memberships (user_id);
create index memberships_org_idx  on memberships (organization_id);

-- platform_admins: superadmin Operon (soporte / gestión de tenants). Vacío por defecto.
create table platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ALOJAMIENTO
-- ============================================================

-- properties: el alojamiento + su configuración (settings viven acá).
create table properties (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,                 -- público; único dentro de la org
  description     text,
  phone           text,
  whatsapp        text,
  email           text,
  address         text,
  city            text,
  country         text default 'AR',
  timezone        text not null default 'America/Argentina/Cordoba',
  currency        text not null default 'ARS',
  checkin_time    time not null default '14:00',
  checkout_time   time not null default '10:00',
  deposit_pct     numeric(5,2) not null default 0,   -- % de seña (futuro Mercado Pago)
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug)
);
create index properties_org_idx on properties (organization_id);

-- units: unidad reservable (cabaña, loft, habitación).
create table units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id     uuid not null references properties(id) on delete cascade,
  name            text not null,
  description     text,
  capacity        int not null default 2 check (capacity > 0),
  is_active       boolean not null default true,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index units_org_idx      on units (organization_id);
create index units_property_idx on units (property_id);

-- rates: tarifas. Base a nivel unidad o property-wide (unit_id null).
-- Diseñado para crecer (estacional / especial) sin rehacer el modelo.
create table rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id     uuid not null references properties(id) on delete cascade,
  unit_id         uuid references units(id) on delete cascade,  -- null = aplica a toda la property
  kind            rate_kind not null default 'base',
  price_per_night numeric(12,2) not null check (price_per_night >= 0),
  currency        text not null default 'ARS',
  start_date      date,                          -- null en 'base'
  end_date        date,                          -- null en 'base'
  min_nights      int not null default 1 check (min_nights >= 1),
  priority        int not null default 0,        -- mayor gana ante empate de fechas
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (kind = 'base' or (start_date is not null and end_date is not null))
);
create index rates_org_idx  on rates (organization_id);
create index rates_unit_idx on rates (unit_id);

-- ============================================================
-- HUÉSPEDES (privado)
-- ============================================================
create table guests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name       text not null,
  email           text,
  phone           text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index guests_org_idx   on guests (organization_id);
-- dedupe por (org, email) case-insensitive; nunca merge por nombre.
create unique index guests_org_email_uidx
  on guests (organization_id, lower(email)) where email is not null;

-- ============================================================
-- RESERVAS (dominio rico)
-- ============================================================
create table reservations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  property_id       uuid not null references properties(id) on delete cascade,
  unit_id           uuid not null references units(id) on delete restrict,
  guest_id          uuid references guests(id) on delete set null,
  code              text not null,                 -- código legible p/ el huésped
  check_in          date not null,
  check_out         date not null,
  guests_count      int not null default 1 check (guests_count > 0),
  status            reservation_status not null default 'pending',
  source            reservation_source not null default 'direct',
  external_channel  text,                          -- futuro: 'booking' | 'airbnb' | ...
  external_reference text,                         -- id de la reserva en el canal externo
  total_amount      numeric(12,2),
  deposit_amount    numeric(12,2),
  currency          text not null default 'ARS',
  notes             text,                          -- observaciones (privado)
  hold_expires_at   timestamptz,                   -- expiración de retención (carrito abandonado)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  check (check_out > check_in),
  unique (organization_id, code)
);
create index reservations_org_idx     on reservations (organization_id);
create index reservations_unit_idx    on reservations (unit_id);
create index reservations_status_idx  on reservations (status);
create index reservations_checkin_idx on reservations (check_in);
create index reservations_guest_idx   on reservations (guest_id);

-- ============================================================
-- OCUPACIÓN: ÚNICA FUENTE DE VERDAD DE DISPONIBILIDAD
-- Reservas (que retienen inventario) y bloqueos comparten esta tabla,
-- para que UNA sola restricción de exclusión impida cualquier solape.
-- ============================================================
create table unit_occupancy (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  unit_id         uuid not null references units(id) on delete cascade,
  during          daterange not null,               -- [check_in, check_out)
  kind            occupancy_kind not null,
  reservation_id  uuid references reservations(id) on delete cascade,
  block_reason    text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  -- coherencia: reserva ⇒ tiene reservation_id; bloqueo ⇒ no.
  check ( (kind = 'reservation' and reservation_id is not null)
       or (kind = 'block'       and reservation_id is null) ),
  -- ⛔ ANTI-DOBLE-RESERVA (race-safe, a nivel base de datos):
  -- dos rangos que se solapan en la misma unidad no pueden coexistir.
  constraint occupancy_no_overlap
    exclude using gist (unit_id with =, during with &&)
);
create index unit_occupancy_org_idx  on unit_occupancy (organization_id);
create index unit_occupancy_unit_idx on unit_occupancy (unit_id);
create index unit_occupancy_during_idx on unit_occupancy using gist (during);
-- una reserva retiene como máximo una fila de ocupación
create unique index unit_occupancy_reservation_uidx
  on unit_occupancy (reservation_id) where reservation_id is not null;

-- ============================================================
-- PAGOS (capa propia; sin lógica de Mercado Pago acá)
-- ============================================================
create table payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  reservation_id  uuid not null references reservations(id) on delete cascade,
  kind            payment_kind not null default 'deposit',
  amount          numeric(12,2) not null,
  currency        text not null default 'ARS',
  status          payment_status not null default 'pending',
  method          text,                          -- 'mercadopago' | 'transferencia' | 'efectivo' | ...
  external_ref    text,                          -- id del proveedor de pago
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index payments_org_idx         on payments (organization_id);
create index payments_reservation_idx on payments (reservation_id);

-- ============================================================
-- Triggers: updated_at automático
-- ============================================================
create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','organizations','memberships','properties',
                           'units','rates','guests','reservations','payments'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ============================================================
-- Auto-creación de profile al registrarse en auth.users.
-- NO otorga acceso a ninguna organización (eso es explícito vía memberships).
-- ============================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
