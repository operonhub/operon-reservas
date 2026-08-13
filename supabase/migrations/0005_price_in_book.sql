-- Centralizar el cálculo de precio en _book: TODA reserva (web o manual) queda
-- con total y seña calculados desde las tarifas + deposit_pct de la property.
create or replace function _book(
  p_org uuid, p_property uuid, p_unit uuid, p_guest_id uuid,
  p_check_in date, p_check_out date, p_guests int,
  p_status reservation_status, p_source reservation_source,
  p_created_by uuid, p_hold_minutes int
) returns public.reservations
language plpgsql security definer set search_path = '' as $$
declare
  v_unit public.units; v_res public.reservations; v_code text;
  v_nights int; v_price numeric; v_deposit_pct numeric; v_currency text;
begin
  if p_check_out <= p_check_in then raise exception 'INVALID_DATES'; end if;

  select * into v_unit from public.units
   where id = p_unit and property_id = p_property
     and organization_id = p_org and is_active = true;
  if not found then raise exception 'UNIT_NOT_FOUND'; end if;
  if p_guests > v_unit.capacity then raise exception 'OVER_CAPACITY'; end if;

  v_code := 'R-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));

  insert into public.reservations (
    organization_id, property_id, unit_id, guest_id, code,
    check_in, check_out, guests_count, status, source, hold_expires_at, created_by
  ) values (
    p_org, p_property, p_unit, p_guest_id, v_code,
    p_check_in, p_check_out, p_guests, p_status, p_source,
    case when p_hold_minutes is not null
         then now() + make_interval(mins => p_hold_minutes) end,
    p_created_by
  ) returning * into v_res;

  if public.holds_inventory(p_status) then
    begin
      insert into public.unit_occupancy
        (organization_id, unit_id, during, kind, reservation_id, created_by)
      values
        (p_org, p_unit, daterange(p_check_in, p_check_out, '[)'), 'reservation', v_res.id, p_created_by);
    exception when exclusion_violation then
      raise exception 'UNAVAILABLE';
    end;
  end if;

  -- Precio + seña (fuente única: tarifas de la property)
  v_nights := p_check_out - p_check_in;
  v_price  := public._unit_price(p_unit, p_check_in, p_check_out);
  if v_price is not null then
    select deposit_pct, currency into v_deposit_pct, v_currency
      from public.properties where id = p_property;
    update public.reservations
       set total_amount   = v_price * v_nights,
           deposit_amount = case when coalesce(v_deposit_pct,0) > 0
                                 then round(v_price * v_nights * v_deposit_pct / 100) else null end,
           currency       = coalesce(v_currency, currency)
     where id = v_res.id
     returning * into v_res;
  end if;

  return v_res;
end; $$;

revoke execute on function public._book(uuid,uuid,uuid,uuid,date,date,int,reservation_status,reservation_source,uuid,int) from public, anon, authenticated;
