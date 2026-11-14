-- Shared order numbers are reserved under a per-store row lock, so different
-- phones, tablets, and the PC cannot assign the same number concurrently.
-- This migration is additive: it does not update public.estado or old orders.

create schema if not exists app_internal;
revoke all on schema app_internal from public, anon, authenticated;

create table if not exists app_internal.pedido_contadores (
  loja_id text primary key,
  ultimo_numero_geral bigint not null default 0 check (ultimo_numero_geral >= 0),
  data_comercial date not null,
  ultimo_numero_diario bigint not null default 0 check (ultimo_numero_diario >= 0),
  atualizado_em timestamptz not null default now()
);

create table if not exists app_internal.pedido_reservas_numero (
  loja_id text not null,
  request_id text not null,
  numero_geral bigint not null,
  numero_dia bigint not null,
  data_comercial date not null,
  criado_em timestamptz not null default now(),
  primary key (loja_id, request_id)
);

alter table app_internal.pedido_contadores enable row level security;
alter table app_internal.pedido_reservas_numero enable row level security;
revoke all on app_internal.pedido_contadores from public, anon, authenticated;
revoke all on app_internal.pedido_reservas_numero from public, anon, authenticated;

create or replace function app_internal.sequencias_atuais_do_estado(
  p_loja_id text,
  p_data_comercial date
)
returns table (ultimo_geral bigint, ultimo_diario bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public, app_internal
as $$
  with loja as (
    select e.dados->'porLoja'->p_loja_id as dados
      from public.estado e
     where e.id = 'atual'
  ), contagem as (
    select
      case when (l.dados->'contadores'->>'geral') ~ '^[0-9]+$'
        then (l.dados->'contadores'->>'geral')::bigint else 0 end as geral,
      case when l.dados->'contadores'->>'dataRef' = p_data_comercial::text
             and (l.dados->'contadores'->>'diario') ~ '^[0-9]+$'
        then (l.dados->'contadores'->>'diario')::bigint else 0 end as diario,
      case when jsonb_typeof(l.dados->'pedidos') = 'array' then l.dados->'pedidos' else '[]'::jsonb end
        || case when jsonb_typeof(l.dados->'historico') = 'array' then l.dados->'historico' else '[]'::jsonb end as lancamentos
      from loja l
  ), itens as (
    select item
      from contagem c
      cross join lateral jsonb_array_elements(c.lancamentos) as x(item)
  ), maximos as (
    select
      coalesce(max(case when (item->>'numero') ~ '^[0-9]+$'
        then (item->>'numero')::bigint else 0 end), 0) as geral,
      coalesce(max(case
        when (item->>'numeroDia') ~ '^[0-9]+$'
         and (item->>'data') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}'
         and ((((item->>'data')::timestamptz at time zone 'America/Sao_Paulo') - interval '6 hours 30 minutes')::date) = p_data_comercial
          then (item->>'numeroDia')::bigint
        else 0 end), 0) as diario
      from itens
  )
  select greatest(c.geral, m.geral), greatest(c.diario, m.diario)
    from contagem c cross join maximos m;
$$;

revoke all on function app_internal.sequencias_atuais_do_estado(text, date) from public, anon, authenticated;

-- Seed from all current stores. Existing orders are read only and never renumbered.
do $$
declare
  v_loja record;
  v_data_comercial date := (((clock_timestamp() at time zone 'America/Sao_Paulo') - interval '6 hours 30 minutes')::date);
  v_seq record;
begin
  for v_loja in
    select x.key as loja_id
      from public.estado e
      cross join lateral jsonb_each(
        case when jsonb_typeof(e.dados->'porLoja') = 'object' then e.dados->'porLoja' else '{}'::jsonb end
      ) as x
     where e.id = 'atual'
  loop
    select * into v_seq
      from app_internal.sequencias_atuais_do_estado(v_loja.loja_id, v_data_comercial);
    insert into app_internal.pedido_contadores
      (loja_id, ultimo_numero_geral, data_comercial, ultimo_numero_diario)
    values (v_loja.loja_id, v_seq.ultimo_geral, v_data_comercial, v_seq.ultimo_diario)
    on conflict (loja_id) do update
      set ultimo_numero_geral = greatest(app_internal.pedido_contadores.ultimo_numero_geral, excluded.ultimo_numero_geral),
          ultimo_numero_diario = case
            when app_internal.pedido_contadores.data_comercial = excluded.data_comercial
              then greatest(app_internal.pedido_contadores.ultimo_numero_diario, excluded.ultimo_numero_diario)
            else excluded.ultimo_numero_diario end,
          data_comercial = excluded.data_comercial,
          atualizado_em = now();
  end loop;
end;
$$;

create or replace function public.reservar_numero_pedido(
  p_loja_id text,
  p_request_id text
)
returns table (numero_geral bigint, numero_dia bigint, data_comercial date)
language plpgsql
security definer
set search_path = pg_catalog, public, app_internal
as $$
declare
  v_agora timestamptz := clock_timestamp();
  v_data_comercial date;
  v_loja_valida boolean;
  v_seq record;
  v_geral bigint;
  v_diario bigint;
  v_data_reservada date;
begin
  if coalesce(length(trim(p_loja_id)), 0) = 0 or length(p_loja_id) > 120
     or coalesce(length(trim(p_request_id)), 0) = 0 or length(p_request_id) > 160 then
    raise exception 'Loja ou identificador de pedido inválido.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.estado e
     where e.id = 'atual'
       and coalesce(e.dados->'porLoja', '{}'::jsonb) ? p_loja_id
  ) into v_loja_valida;
  if not v_loja_valida then
    raise exception 'A loja informada não existe no estado compartilhado.' using errcode = '22023';
  end if;

  v_data_comercial := (((v_agora at time zone 'America/Sao_Paulo') - interval '6 hours 30 minutes')::date);
  select * into v_seq from app_internal.sequencias_atuais_do_estado(p_loja_id, v_data_comercial);
  insert into app_internal.pedido_contadores
    (loja_id, ultimo_numero_geral, data_comercial, ultimo_numero_diario)
  values (p_loja_id, coalesce(v_seq.ultimo_geral, 0), v_data_comercial, coalesce(v_seq.ultimo_diario, 0))
  on conflict (loja_id) do nothing;

  select c.ultimo_numero_geral, c.ultimo_numero_diario, c.data_comercial
    into v_geral, v_diario, v_data_reservada
    from app_internal.pedido_contadores c
   where c.loja_id = p_loja_id
   for update;

  select r.numero_geral, r.numero_dia, r.data_comercial
    into v_geral, v_diario, v_data_reservada
    from app_internal.pedido_reservas_numero r
   where r.loja_id = p_loja_id and r.request_id = p_request_id;
  if found then
    return query select v_geral, v_diario, v_data_reservada;
    return;
  end if;

  select c.ultimo_numero_geral, c.ultimo_numero_diario, c.data_comercial
    into v_geral, v_diario, v_data_reservada
    from app_internal.pedido_contadores c
   where c.loja_id = p_loja_id;
  if v_data_reservada <> v_data_comercial then
    v_diario := 0;
    v_data_reservada := v_data_comercial;
  end if;
  v_geral := v_geral + 1;
  v_diario := v_diario + 1;

  update app_internal.pedido_contadores c
     set ultimo_numero_geral = v_geral,
         ultimo_numero_diario = v_diario,
         data_comercial = v_data_comercial,
         atualizado_em = v_agora
   where c.loja_id = p_loja_id;
  insert into app_internal.pedido_reservas_numero
    (loja_id, request_id, numero_geral, numero_dia, data_comercial)
  values (p_loja_id, p_request_id, v_geral, v_diario, v_data_comercial);

  return query select v_geral, v_diario, v_data_comercial;
end;
$$;

revoke all on function public.reservar_numero_pedido(text, text) from public, anon, authenticated;
grant execute on function public.reservar_numero_pedido(text, text) to anon, authenticated;

-- Let staff remove a job only while it is still waiting; an active print job is protected.
grant delete on public.fila_impressao to anon, authenticated;
drop policy if exists fila_impressao_delete_pending on public.fila_impressao;
create policy fila_impressao_delete_pending on public.fila_impressao
  for delete to anon, authenticated
  using (status = 'pendente');
