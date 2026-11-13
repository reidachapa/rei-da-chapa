create or replace function public.fila_impressao_reenviar(
  p_job_id uuid,
  p_loja_id text,
  p_estacao_id text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.fila_impressao_estacoes e
     where e.loja_id = p_loja_id and e.estacao_id = p_estacao_id and e.lease_ate > now()
  ) then
    return false;
  end if;
  update public.fila_impressao q
     set status = 'pendente', estacao_id = null, lease_ate = null,
         erro = null, criado_em = now(), atualizado_em = now()
   where q.id = p_job_id and q.loja_id = p_loja_id and q.status = 'conferir';
  return found;
end;
$$;

revoke all on function public.fila_impressao_reenviar(uuid, text, text) from public;
grant execute on function public.fila_impressao_reenviar(uuid, text, text) to anon, authenticated;
