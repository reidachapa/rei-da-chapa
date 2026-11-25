-- Configure the scheduler secret in Vault before activating this job.
create function app_internal.rei_enfileirar_processamento_fotos(
  operacao text, registro text, limite integer, administrativo boolean default false
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  token text;
  expira text := ((extract(epoch from clock_timestamp()) * 1000)::bigint + 120000)::text;
  assinatura text;
begin
  select decrypted_secret into token from vault.decrypted_secrets
  where name = case when administrativo then 'rei_fotos_catalogo_admin' else 'rei_fotos_catalogo_agendamento' end
  limit 1;
  if token is null then return null; end if;
  assinatura := encode(extensions.hmac(
    convert_to(concat_ws('|', expira, operacao, registro, limite::text, '0'), 'UTF8'),
    sha256(convert_to(token, 'UTF8')), 'sha256'), 'hex');
  return net.http_post(
    url := 'https://etzbidgbyntiidtsarln.supabase.co/functions/v1/rei-fotos-catalogo',
    headers := jsonb_build_object('content-type','application/json',
      'x-rei-fotos-expira',expira,'x-rei-fotos-assinatura',assinatura),
    body := jsonb_build_object('op',operacao,'id',registro,'limit',limite),
    timeout_milliseconds := 45000
  );
end;
$$;
revoke all on function app_internal.rei_enfileirar_processamento_fotos(text,text,integer,boolean)
  from public, anon, authenticated;

create function app_internal.rei_processar_fotos_pendentes()
returns bigint[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  registro text;
  requisicoes bigint[] := array[]::bigint[];
begin
  for registro in
    with recente as materialized (
      select e.id, e.dados
      from public.estado e
      where e.id like 'backup\_%' escape '\'
        and e.atualizado_em > now() - interval '1 day'
      order by e.atualizado_em desc limit 8
    )
    select e.id from public.estado e
    where e.id = 'atual' and (
      jsonb_path_exists(e.dados, '$.porLoja.*.produtos[*].imagem ? (@ starts with "data:image/")')
      or jsonb_path_exists(e.dados, '$.porLoja.*.ingredientes[*].imagem ? (@ starts with "data:image/")')
    )
    union all
    select id from (
      select r.id from recente r
      where jsonb_path_exists(r.dados, '$.snapshot.produtos[*].imagem ? (@ starts with "data:image/")')
        or jsonb_path_exists(r.dados, '$.snapshot.ingredientes[*].imagem ? (@ starts with "data:image/")')
      limit 1
    ) b
  loop
    requisicoes := array_append(requisicoes,
      app_internal.rei_enfileirar_processamento_fotos('run',registro,12));
  end loop;
  return requisicoes;
end;
$$;

revoke all on function app_internal.rei_processar_fotos_pendentes() from public, anon, authenticated;
