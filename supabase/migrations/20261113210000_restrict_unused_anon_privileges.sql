-- Keep the current anonymous app flow working while removing table actions
-- the client never uses. This changes permissions only; it does not change rows
-- or the existing RLS policies.
begin;

revoke insert, delete, truncate, references, trigger
  on public.estado
  from public, anon, authenticated;
grant select, update on public.estado to anon, authenticated;

revoke delete, truncate, references, trigger
  on public.fila_impressao
  from public, anon, authenticated;
grant select, insert, update on public.fila_impressao to anon, authenticated;

revoke delete, truncate, references, trigger
  on public.fila_impressao_estacoes
  from public, anon, authenticated;
grant select, insert, update on public.fila_impressao_estacoes to anon, authenticated;

commit;
