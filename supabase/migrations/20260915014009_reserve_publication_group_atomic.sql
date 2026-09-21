create or replace function public.reserve_publication_group(p_group_id uuid)
returns setof public.publicacoes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total integer;
  v_position_1 integer;
  v_position_2 integer;
  v_ready integer;
  v_updated integer;
begin
  perform 1
  from public.publicacoes
  where publication_group_id = p_group_id
  order by id
  for update;

  select
    count(*),
    count(*) filter (where carousel_position = 1),
    count(*) filter (where carousel_position = 2),
    count(*) filter (where status = 'APROVADO' and published_at is null)
  into
    v_total,
    v_position_1,
    v_position_2,
    v_ready
  from public.publicacoes
  where publication_group_id = p_group_id;

  if v_total <> 2
     or v_position_1 <> 1
     or v_position_2 <> 1
     or v_ready <> 2 then
    return;
  end if;

  update public.publicacoes
  set
    status = 'PUBLICANDO',
    atualizado_em = now()
  where publication_group_id = p_group_id
    and status = 'APROVADO'
    and published_at is null;

  get diagnostics v_updated = row_count;

  if v_updated <> 2 then
    raise exception 'Nao foi possivel reservar atomicamente os dois editoriais do carrossel.';
  end if;

  return query
  select p.*
  from public.publicacoes p
  where p.publication_group_id = p_group_id
  order by p.carousel_position;
end;
$$;

revoke all on function public.reserve_publication_group(uuid) from public;
revoke all on function public.reserve_publication_group(uuid) from anon;
revoke all on function public.reserve_publication_group(uuid) from authenticated;
grant execute on function public.reserve_publication_group(uuid) to service_role;
