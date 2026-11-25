create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
revoke all on table net.http_request_queue from public, anon, authenticated;
revoke all on table net._http_response from public, anon, authenticated;
