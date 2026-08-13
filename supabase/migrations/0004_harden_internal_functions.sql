-- Endurecimiento: las funciones INTERNAS no deben ser parte de la API REST.
-- Supabase concede EXECUTE por defecto a anon/authenticated en funciones nuevas
-- del schema public, así que revoke-from-public no alcanza: hay que revocar
-- explícitamente a anon y authenticated. Las wrappers SECURITY DEFINER siguen
-- pudiendo invocarlas (corren como owner).
revoke execute on function public._book(uuid,uuid,uuid,uuid,date,date,int,reservation_status,reservation_source,uuid,int) from anon, authenticated;
revoke execute on function public._upsert_guest(uuid,text,text,text)  from anon, authenticated;
revoke execute on function public._resolve_property(text,text)        from anon, authenticated;
revoke execute on function public._unit_price(uuid,date,date)         from anon, authenticated;
