-- Keep counter tables private to the API surface and call the reservation RPC
-- as the requesting role; table access remains inside an unexposed schema.
grant usage on schema app_internal to anon, authenticated;
grant select, insert, update on app_internal.pedido_contadores to anon, authenticated;
grant select, insert on app_internal.pedido_reservas_numero to anon, authenticated;

drop policy if exists pedido_contadores_select_app on app_internal.pedido_contadores;
create policy pedido_contadores_select_app on app_internal.pedido_contadores
  for select to anon, authenticated using (true);
drop policy if exists pedido_contadores_insert_app on app_internal.pedido_contadores;
create policy pedido_contadores_insert_app on app_internal.pedido_contadores
  for insert to anon, authenticated with check (true);
drop policy if exists pedido_contadores_update_app on app_internal.pedido_contadores;
create policy pedido_contadores_update_app on app_internal.pedido_contadores
  for update to anon, authenticated using (true) with check (true);

drop policy if exists pedido_reservas_select_app on app_internal.pedido_reservas_numero;
create policy pedido_reservas_select_app on app_internal.pedido_reservas_numero
  for select to anon, authenticated using (true);
drop policy if exists pedido_reservas_insert_app on app_internal.pedido_reservas_numero;
create policy pedido_reservas_insert_app on app_internal.pedido_reservas_numero
  for insert to anon, authenticated with check (true);

grant execute on function app_internal.sequencias_atuais_do_estado(text, date) to anon, authenticated;

create or replace function public.reservar_numero_pedido(
  p_loja_id text,
  p_request_id text
)
returns table (numero_geral bigint, numero_dia bigint, data_comercial date)
language plpgsql
security invoker
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
