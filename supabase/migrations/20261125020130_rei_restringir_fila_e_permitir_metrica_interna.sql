revoke usage on schema net from public, anon, authenticated;
revoke all on table net.http_request_queue from public, anon, authenticated;
revoke all on table net._http_response from public, anon, authenticated;
grant usage on schema app_internal to service_role;
grant execute on function app_internal.rei_uso_fotos_catalogo() to service_role;
grant execute on function public.rei_uso_fotos_catalogo() to service_role;
