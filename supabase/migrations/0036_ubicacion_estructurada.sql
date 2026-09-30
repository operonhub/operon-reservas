-- ============================================================
-- 0036 — Ubicación estructurada del alojamiento
-- ============================================================
-- Hasta acá la ciudad era texto libre ("Villa Carlos Paz, Cordoba"), y de
-- ese texto salía la zona de "Tu zona este mes": una coma o una abreviatura
-- dejaban al cliente sin zona. Ahora el dueño busca su dirección (Google) y
-- ajusta un pin; con el punto, Georef devuelve provincia, departamento y
-- localidad oficiales. La localidad oficial se guarda como `city`, así todo
-- lo que ya usa la ciudad (zona, página de reservas) sigue igual.
--
-- Los códigos oficiales quedan guardados para, más adelante, distinguir
-- localidades homónimas de distintas provincias en la clave de zona.
-- ============================================================

alter table public.properties
  add column if not exists lat             double precision,
  add column if not exists lng             double precision,
  add column if not exists place_id        text,
  add column if not exists province_id     text,
  add column if not exists province_name   text,
  add column if not exists department_id   text,
  add column if not exists department_name text,
  add column if not exists locality_id     text,
  add column if not exists located_at      timestamptz;

alter table public.properties
  add constraint properties_location_point_chk check ((lat is null) = (lng is null)),
  add constraint properties_location_ar_chk check (
    lat is null or (lat between -56 and -21 and lng between -74 and -53)
  ),
  add constraint properties_location_text_chk check (
    coalesce(char_length(place_id), 0) <= 300
    and coalesce(char_length(province_id), 0) <= 10
    and coalesce(char_length(province_name), 0) <= 80
    and coalesce(char_length(department_id), 0) <= 10
    and coalesce(char_length(department_name), 0) <= 80
    and coalesce(char_length(locality_id), 0) <= 10
  );

-- payload: { name, slug, city?, currency, timezone, checkin_time, checkout_time,
--            units: [{ name, capacity, price }],
--            location?: { address, lat, lng, place_id, province_id, province_name,
--                         department_id, department_name, locality_id, city } }
-- Copia exacta de 0026 (verificada contra producción) + la ubicación.
create or replace function complete_setup(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_name      text := trim(coalesce(p_payload->>'name', ''));
  v_slug      text := lower(trim(coalesce(p_payload->>'slug', '')));
  v_city      text := nullif(trim(coalesce(p_payload->>'city', '')), '');
  v_currency  text := upper(trim(coalesce(p_payload->>'currency', 'ARS')));
  v_tz        text := coalesce(nullif(p_payload->>'timezone', ''), 'America/Argentina/Cordoba');
  v_units     jsonb := p_payload->'units';
  v_loc       jsonb := p_payload->'location';
  v_lat       double precision;
  v_lng       double precision;
  v_address   text;
  v_checkin   time;
  v_checkout  time;
  v_unit      jsonb;
  v_unit_name text;
  v_capacity  int;
  v_price     numeric;
  v_names     text[] := '{}';
  v_position  int := 0;
  v_org       uuid;
  v_prop      uuid;
  v_unit_id   uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Un doble click manda dos llamadas: la segunda espera acá y encuentra el
  -- permiso ya consumido.
  perform pg_advisory_xact_lock(hashtext('complete_setup:' || v_uid::text));

  if not exists (
    select 1 from app_private.setup_grants g where g.user_id = v_uid and g.consumed_at is null
  ) then
    raise exception 'NO_GRANT';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    raise exception 'ALREADY_MEMBER';
  end if;

  -- Con ubicación, la ciudad es la localidad oficial que viene con ella.
  if jsonb_typeof(v_loc) = 'object' then
    begin
      v_lat := (v_loc->>'lat')::double precision;
      v_lng := (v_loc->>'lng')::double precision;
    exception when others then
      raise exception 'INVALID_LOCATION';
    end;
    v_address := nullif(trim(coalesce(v_loc->>'address', '')), '');
    if v_lat is null or v_lng is null or v_address is null or char_length(v_address) > 200 then
      raise exception 'INVALID_LOCATION';
    end if;
    v_city := coalesce(nullif(trim(coalesce(v_loc->>'city', '')), ''), v_city);
  elsif v_loc is not null and jsonb_typeof(v_loc) <> 'null' then
    raise exception 'INVALID_LOCATION';
  end if;

  if char_length(v_name) not between 2 and 80 then raise exception 'INVALID_NAME'; end if;
  if not app_private.slug_is_valid(v_slug) then raise exception 'INVALID_SLUG'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
  if v_city is not null and char_length(v_city) > 80 then raise exception 'INVALID_CITY'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = v_tz) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  begin
    v_checkin  := coalesce(nullif(p_payload->>'checkin_time', ''), '14:00')::time;
    v_checkout := coalesce(nullif(p_payload->>'checkout_time', ''), '10:00')::time;
  exception when others then
    raise exception 'INVALID_TIME';
  end;

  if coalesce(jsonb_typeof(v_units), '') <> 'array' or jsonb_array_length(v_units) not between 1 and 30 then
    raise exception 'INVALID_UNITS';
  end if;

  begin
    insert into public.organizations (name, slug) values (v_name, v_slug) returning id into v_org;
  exception when unique_violation then
    raise exception 'SLUG_TAKEN';
  end;

  insert into public.memberships (organization_id, user_id, role) values (v_org, v_uid, 'owner');

  begin
    insert into public.properties (
      organization_id, name, slug, city, currency, timezone, checkin_time, checkout_time,
      address, lat, lng, place_id, province_id, province_name, department_id, department_name,
      locality_id, located_at)
    values (
      v_org, v_name, v_slug, v_city, v_currency, v_tz, v_checkin, v_checkout,
      v_address, v_lat, v_lng,
      nullif(v_loc->>'place_id', ''), nullif(v_loc->>'province_id', ''), nullif(v_loc->>'province_name', ''),
      nullif(v_loc->>'department_id', ''), nullif(v_loc->>'department_name', ''),
      nullif(v_loc->>'locality_id', ''), case when v_lat is not null then now() end)
    returning id into v_prop;
  exception when check_violation then
    -- Punto fuera de la Argentina o textos demasiado largos.
    raise exception 'INVALID_LOCATION';
  end;

  for v_unit in select value from jsonb_array_elements(v_units) loop
    v_unit_name := trim(coalesce(v_unit->>'name', ''));
    if char_length(v_unit_name) not between 1 and 60 then raise exception 'INVALID_UNIT_NAME'; end if;
    if lower(v_unit_name) = any (v_names) then raise exception 'DUPLICATE_UNIT_NAME'; end if;
    v_names := v_names || lower(v_unit_name);

    begin
      v_capacity := (v_unit->>'capacity')::int;
      v_price    := (v_unit->>'price')::numeric;
    exception when others then
      raise exception 'INVALID_UNIT';
    end;
    if v_capacity is null or v_capacity not between 1 and 50 then raise exception 'INVALID_CAPACITY'; end if;
    if v_price is null or v_price <= 0 or v_price >= 10000000000 or v_price <> round(v_price, 2) then
      raise exception 'INVALID_PRICE';
    end if;

    insert into public.units (organization_id, property_id, name, capacity, position)
    values (v_org, v_prop, v_unit_name, v_capacity, v_position)
    returning id into v_unit_id;

    insert into public.rates (organization_id, property_id, unit_id, kind, label, price_per_night, currency, min_nights, is_active)
    values (v_org, v_prop, v_unit_id, 'base', 'Tarifa base', v_price, v_currency, 1, true);

    v_position := v_position + 1;
  end loop;

  update app_private.setup_grants
     set consumed_at = now(), organization_id = v_org, draft = '{}'::jsonb
   where user_id = v_uid;

  return v_org;
end $$;
