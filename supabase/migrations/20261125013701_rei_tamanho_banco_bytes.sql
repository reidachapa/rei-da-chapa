create function public.rei_tamanho_banco_bytes()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.pg_database_size(pg_catalog.current_database());
$$;

revoke all on function public.rei_tamanho_banco_bytes() from public;
grant execute on function public.rei_tamanho_banco_bytes() to anon, authenticated;
