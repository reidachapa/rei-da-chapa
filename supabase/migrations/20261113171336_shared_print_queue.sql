-- Fila compartilhada de impressão. Não altera public.estado nem suas policies.
create table if not exists public.fila_impressao (
  id uuid primary key default gen_random_uuid(),
  loja_id text not null,
  chave_evento text not null,
  pedido_id text not null,
  tipo text not null check (tipo in ('novo', 'alteracao', 'reimpressao')),
  payload jsonb not null,
  status text not null default 'pendente' check (status in ('pendente', 'imprimindo', 'impresso', 'conferir')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  impresso_em timestamptz,
  tentativas integer not null default 0 check (tentativas >= 0),
  estacao_id text,
  lease_ate timestamptz,
  erro text,
  constraint fila_impressao_evento_unico unique (loja_id, chave_evento)
);

create index if not exists fila_impressao_proximos_idx
  on public.fila_impressao (loja_id, status, criado_em, id);

create table if not exists public.fila_impressao_estacoes (
  loja_id text primary key,
  estacao_id text,
  nome_estacao text,
  heartbeat_em timestamptz not null default now(),
  lease_ate timestamptz not null default now()
);

alter table public.fila_impressao enable row level security;
alter table public.fila_impressao_estacoes enable row level security;

grant select, insert, update on public.fila_impressao to anon, authenticated;
grant select, insert, update on public.fila_impressao_estacoes to anon, authenticated;

drop policy if exists fila_impressao_select_app on public.fila_impressao;
create policy fila_impressao_select_app on public.fila_impressao
  for select to anon, authenticated using (true);
drop policy if exists fila_impressao_insert_app on public.fila_impressao;
create policy fila_impressao_insert_app on public.fila_impressao
  for insert to anon, authenticated with check (true);
drop policy if exists fila_impressao_update_app on public.fila_impressao;
create policy fila_impressao_update_app on public.fila_impressao
  for update to anon, authenticated using (true) with check (true);

drop policy if exists fila_impressao_estacoes_select_app on public.fila_impressao_estacoes;
create policy fila_impressao_estacoes_select_app on public.fila_impressao_estacoes
  for select to anon, authenticated using (true);
drop policy if exists fila_impressao_estacoes_insert_app on public.fila_impressao_estacoes;
create policy fila_impressao_estacoes_insert_app on public.fila_impressao_estacoes
  for insert to anon, authenticated with check (true);
drop policy if exists fila_impressao_estacoes_update_app on public.fila_impressao_estacoes;
create policy fila_impressao_estacoes_update_app on public.fila_impressao_estacoes
  for update to anon, authenticated using (true) with check (true);

create or replace function public.fila_impressao_reservar_estacao(
  p_loja_id text,
  p_estacao_id text,
  p_nome_estacao text,
  p_lease_segundos integer default 60
)
returns table (reservada boolean, id_estacao text, nome_estacao text, lease_ate timestamptz)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v public.fila_impressao_estacoes%rowtype;
begin
  if coalesce(trim(p_loja_id), '') = '' or coalesce(trim(p_estacao_id), '') = '' then
    return query select false, null::text, null::text, null::timestamptz;
    return;
  end if;
  insert into public.fila_impressao_estacoes as atual
    (loja_id, estacao_id, nome_estacao, heartbeat_em, lease_ate)
  values
    (p_loja_id, p_estacao_id, left(coalesce(p_nome_estacao, 'Impressora'), 80), now(),
     now() + make_interval(secs => greatest(30, least(coalesce(p_lease_segundos, 60), 120))))
  on conflict (loja_id) do update
    set estacao_id = excluded.estacao_id,
        nome_estacao = excluded.nome_estacao,
        heartbeat_em = now(),
        lease_ate = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_segundos, 60), 120)))
  where atual.lease_ate <= now() or atual.estacao_id = excluded.estacao_id
  returning atual.* into v;
  if not found then
    return query select false, null::text, null::text, null::timestamptz;
    return;
  end if;
  return query select true, v.estacao_id, v.nome_estacao, v.lease_ate;
end;
$$;

create or replace function public.fila_impressao_renovar_estacao(
  p_loja_id text,
  p_estacao_id text,
  p_lease_segundos integer default 60
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.fila_impressao_estacoes
     set heartbeat_em = now(),
         lease_ate = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_segundos, 60), 120)))
   where loja_id = p_loja_id
     and estacao_id = p_estacao_id
     and lease_ate > now();
  return found;
end;
$$;

create or replace function public.fila_impressao_liberar_estacao(p_loja_id text, p_estacao_id text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.fila_impressao_estacoes
     set estacao_id = null, nome_estacao = null, heartbeat_em = now(), lease_ate = now()
   where loja_id = p_loja_id and estacao_id = p_estacao_id;
  return found;
end;
$$;

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

  if not exists (
    select 1 from public.fila_impressao_estacoes e
     where e.loja_id = p_loja_id and e.estacao_id = p_estacao_id and e.lease_ate > now()
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

create or replace function public.fila_impressao_finalizar(
  p_job_id uuid,
  p_loja_id text,
  p_estacao_id text,
  p_impresso boolean,
  p_erro text default null
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
     set status = case when p_impresso then 'impresso' else 'conferir' end,
         payload = case when p_impresso then '{}'::jsonb else q.payload end,
         impresso_em = case when p_impresso then now() else null end,
         lease_ate = null,
         erro = case when p_impresso then null else left(coalesce(p_erro, 'Impressão precisa ser conferida.'), 500) end,
         atualizado_em = now()
   where q.id = p_job_id and q.loja_id = p_loja_id
     and q.estacao_id = p_estacao_id and q.status in ('imprimindo', 'conferir');
  return found;
end;
$$;

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
         erro = null, atualizado_em = now()
   where q.id = p_job_id and q.loja_id = p_loja_id and q.status = 'conferir';
  return found;
end;
$$;

revoke all on function public.fila_impressao_reservar_estacao(text, text, text, integer) from public;
revoke all on function public.fila_impressao_renovar_estacao(text, text, integer) from public;
revoke all on function public.fila_impressao_liberar_estacao(text, text) from public;
revoke all on function public.fila_impressao_proximo(text, text, integer) from public;
revoke all on function public.fila_impressao_finalizar(uuid, text, text, boolean, text) from public;
revoke all on function public.fila_impressao_reenviar(uuid, text, text) from public;
grant execute on function public.fila_impressao_reservar_estacao(text, text, text, integer) to anon, authenticated;
grant execute on function public.fila_impressao_renovar_estacao(text, text, integer) to anon, authenticated;
grant execute on function public.fila_impressao_liberar_estacao(text, text) to anon, authenticated;
grant execute on function public.fila_impressao_proximo(text, text, integer) to anon, authenticated;
grant execute on function public.fila_impressao_finalizar(uuid, text, text, boolean, text) to anon, authenticated;
grant execute on function public.fila_impressao_reenviar(uuid, text, text) to anon, authenticated;
