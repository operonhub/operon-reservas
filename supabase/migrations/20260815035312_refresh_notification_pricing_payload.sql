-- _book() inserta la reserva y luego completa total/seña en la misma
-- transacción. Actualizamos el snapshot de la outbox antes de que pg_net
-- invoque al worker después del commit.
create or replace function refresh_reservation_notification_pricing()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_outbox
     set payload = payload || jsonb_build_object(
       'total_amount', new.total_amount,
       'deposit_amount', new.deposit_amount,
       'currency', new.currency
     )
   where reservation_id = new.id
     and event_type = 'reservation_created_admin'
     and delivery_status in ('pending', 'processing');

  return new;
end;
$$;

revoke execute on function refresh_reservation_notification_pricing()
  from public, anon, authenticated;

create trigger reservations_refresh_notification_pricing
  after update of total_amount, deposit_amount, currency on reservations
  for each row
  when (
    old.total_amount is distinct from new.total_amount
    or old.deposit_amount is distinct from new.deposit_amount
    or old.currency is distinct from new.currency
  )
  execute function refresh_reservation_notification_pricing();
