-- Product images use immutable object names and are readable by URL.
-- No client role receives permission to write or enumerate the bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rei-catalogo-fotos', 'rei-catalogo-fotos', true, 524288, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create function app_internal.rei_uso_fotos_catalogo()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('arquivos', count(*), 'bytes',
    coalesce(sum(case when o.metadata ->> 'size' ~ '^[0-9]{1,12}$'
      then (o.metadata ->> 'size')::bigint else 0 end), 0))
  from storage.objects o
  where o.bucket_id = 'rei-catalogo-fotos';
$$;

create function public.rei_uso_fotos_catalogo()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select app_internal.rei_uso_fotos_catalogo(); $$;

revoke all on function app_internal.rei_uso_fotos_catalogo() from public;
revoke all on function public.rei_uso_fotos_catalogo() from public;
grant usage on schema app_internal to anon, authenticated;
grant execute on function app_internal.rei_uso_fotos_catalogo() to anon, authenticated;
grant execute on function public.rei_uso_fotos_catalogo() to anon, authenticated;
