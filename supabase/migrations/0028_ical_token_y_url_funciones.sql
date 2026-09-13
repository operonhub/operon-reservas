-- ============================================================
-- 0028 — Link de exportación iCal con token (B-01) y la URL de las
-- Edge Functions fuera de las migraciones (B-07)
-- ============================================================

-- ------------------------------------------------------------
-- B-01 · El link de exportación del calendario
-- ------------------------------------------------------------
-- 0018 decía que la URL no se podía adivinar porque la clave era el uuid de
-- la unidad, pero public_availability (abierta a anon) devuelve ese uuid: con
-- el slug público de un complejo alcanzaba para bajarse el histórico completo
-- de ocupación de cada unidad. Ahora el feed exige un token propio de la
-- unidad, que solo ven los miembros del complejo, y devuelve desde hace 30
-- días en adelante, que es todo lo que Airbnb y Booking necesitan.
-- Al aplicarla nadie usaba todavía el link (0 pedidos a /ical en 7 días).

-- Default volátil: cada unidad existente recibe su propio token al agregar
-- la columna.
alter table public.units
  add column if not exists ical_token text not null default encode(gen_random_bytes(18), 'hex');

alter table public.units drop constraint if exists units_ical_token_key;
alter table public.units add constraint units_ical_token_key unique (ical_token);

drop function if exists public.public_ical_feed(uuid);

create or replace function public_ical_feed(p_unit_id uuid, p_token text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit record;
  v_ranges jsonb;
begin
  select u.id, u.name as unit_name, p.name as property_name
    into v_unit
  from public.units u
  join public.properties p on p.id = u.property_id
  where u.id = p_unit_id and u.ical_token = p_token;

  -- Unidad inexistente y token equivocado responden igual: no confirma qué
  -- uuid existe.
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', o.id,
               'start_date', lower(o.during),
               'end_date', upper(o.during)
             )
             order by lower(o.during)
           ),
           '[]'::jsonb
         )
    into v_ranges
  from public.unit_occupancy o
  where o.unit_id = p_unit_id
    and upper(o.during) >= current_date - 30;

  return jsonb_build_object(
    'found', true,
    'unit_name', v_unit.unit_name,
    'property_name', v_unit.property_name,
    'ranges', v_ranges
  );
end;
$$;

revoke execute on function public_ical_feed(uuid, text) from public;
grant execute on function public_ical_feed(uuid, text) to anon, authenticated;


-- ------------------------------------------------------------
-- B-07 · La URL de las Edge Functions deja de estar escrita en el código
-- ------------------------------------------------------------
-- wake_notification_worker (0006) y wake_ical_sync_worker (0023) tenían la
-- dirección de producción escrita a mano: correr las migraciones en otra base
-- (staging, una rama, el proyecto equivocado) disparaba las funciones de
-- producción. Ahora la URL se carga una vez por proyecto en esta tabla; sin
-- URL, las funciones no llaman a nada.
--
-- Después de aplicar, en producción:
--   update app_private.edge_functions_config
--      set base_url = 'https://<ref>.supabase.co/functions/v1';
create schema if not exists app_private;

create table if not exists app_private.edge_functions_config (
  singleton  boolean primary key default true check (singleton),
  base_url   text check (base_url is null or base_url ~ '^https://[a-z0-9.-]+/functions/v1$'),
  updated_at timestamptz not null default now()
);
alter table app_private.edge_functions_config enable row level security;
revoke all on app_private.edge_functions_config from public, anon, authenticated;

insert into app_private.edge_functions_config (singleton) values (true)
on conflict (singleton) do nothing;

create or replace function app_private.edge_function_url(p_name text)
returns text
language sql stable set search_path = '' as $$
  select c.base_url || '/' || p_name
    from app_private.edge_functions_config c
   where c.singleton and c.base_url is not null;
$$;
revoke all on function app_private.edge_function_url(text) from public;

create or replace function wake_notification_worker()
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := app_private.edge_function_url('notify-reservations');
  v_token text;
  v_request_id bigint;
begin
  if v_url is null then return null; end if;

  select worker_token into v_token
  from app_private.notification_worker_config
  where singleton;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-token', v_token
    ),
    body := jsonb_build_object('source', 'notification_outbox'),
    timeout_milliseconds := 5000
  ) into v_request_id;

  return v_request_id;
end;
$$;

create or replace function wake_ical_sync_worker()
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := app_private.edge_function_url('sync-external-calendars');
  v_token text;
  v_request_id bigint;
begin
  if v_url is null then return null; end if;

  select worker_token into v_token
  from app_private.ical_sync_worker_config
  where singleton;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-token', v_token
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function wake_notification_worker() from public, anon, authenticated;
revoke execute on function wake_ical_sync_worker() from public, anon, authenticated;
grant execute on function wake_notification_worker() to service_role;
grant execute on function wake_ical_sync_worker() to service_role;
