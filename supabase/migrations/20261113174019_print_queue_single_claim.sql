create or replace function public.fila_impressao_proximo(
  p_loja_id text,
  p_estacao_id text,
  p_lease_segundos integer default 90
)
returns setof public.fila_impressao
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_job public.fila_impressao%rowtype;
begin
  update public.fila_impressao
     set status = 'conferir', estacao_id = null, lease_ate = null,
         erro = coalesce(erro, 'A estação parou durante o envio; confira o papel antes de reenviar.'), atualizado_em = now()
   where loja_id = p_loja_id and status = 'imprimindo' and lease_ate <= now();

  perform 1 from public.fila_impressao_estacoes e
   where e.loja_id = p_loja_id and e.estacao_id = p_estacao_id and e.lease_ate > now()
   for update;
  if not found then return; end if;

  if exists (
    select 1 from public.fila_impressao q
     where q.loja_id = p_loja_id and q.estacao_id = p_estacao_id
       and q.status = 'imprimindo' and q.lease_ate > now()
  ) then
    return;
  end if;

  select q.id into v_id
    from public.fila_impressao q
   where q.loja_id = p_loja_id and q.status = 'pendente'
   order by q.criado_em, q.id
   for update skip locked
   limit 1;
  if not found then return; end if;

  update public.fila_impressao q
     set status = 'imprimindo', estacao_id = p_estacao_id,
         lease_ate = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_segundos, 90), 180))),
         tentativas = q.tentativas + 1, atualizado_em = now(), erro = null
   where q.id = v_id
  returning q.* into v_job;
  return next v_job;
end;
$$;

revoke all on function public.fila_impressao_proximo(text, text, integer) from public;
grant execute on function public.fila_impressao_proximo(text, text, integer) to anon, authenticated;
