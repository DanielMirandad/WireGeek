create or replace function public.repair_missing_publication_group(
  p_noticia_id bigint,
  p_requested_group_id uuid
)
returns setof public.publicacoes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total integer;
begin
  if p_noticia_id is null or p_noticia_id <= 0 or p_requested_group_id is null then
    raise exception 'INVALID_REPAIR_REQUEST';
  end if;

  perform pg_advisory_xact_lock(p_noticia_id);

  if exists (
    select 1
    from public.publicacoes
    where noticia_id = p_noticia_id
      and publication_group_id is not null
      and status in ('APROVADO','AGUARDANDO_APROVACAO','PUBLICANDO','AGENDADO','PUBLICADO')
  ) then
    raise exception 'ACTIVE_GROUP_ALREADY_EXISTS';
  end if;

  select count(*)
    into v_total
  from public.publicacoes
  where noticia_id = p_noticia_id
    and publication_group_id is null
    and status = 'APROVADO';

  if v_total not in (1, 2) then
    raise exception 'GROUP_REPAIR_AMBIGUOUS';
  end if;

  if exists (
    select 1
    from public.publicacoes
    where noticia_id = p_noticia_id
      and publication_group_id is null
      and status = 'APROVADO'
      and (
        published_at is not null
        or scheduled_at is not null
        or coalesce(cardinality(selected_channels), 0) <> 0
        or instagram_status <> 'NAO_SELECIONADO'
        or instagram_post_id is not null
        or instagram_url is not null
        or instagram_parent_container_id is not null
        or instagram_child_container_ids is not null
        or instagram_containers_created_at is not null
        or instagram_caption_sha256 is not null
        or youtube_status <> 'NAO_SELECIONADO'
        or youtube_video_id is not null
        or youtube_url is not null
        or facebook_url is not null
        or idempotency_key is not null
        or publish_attempts <> 0
        or last_error is not null
      )
  ) then
    raise exception 'GROUP_REPAIR_UNSAFE';
  end if;

  perform 1
  from public.publicacoes
  where noticia_id = p_noticia_id
    and publication_group_id is null
    and status = 'APROVADO'
  order by id
  for update;

  with ordered as (
    select
      id,
      row_number() over (order by id)::smallint as position
    from public.publicacoes
    where noticia_id = p_noticia_id
      and publication_group_id is null
      and status = 'APROVADO'
  )
  update public.publicacoes p
     set publication_group_id = p_requested_group_id,
         carousel_position = ordered.position,
         atualizado_em = now()
    from ordered
   where p.id = ordered.id;

  return query
    select *
    from public.publicacoes
    where publication_group_id = p_requested_group_id
    order by carousel_position;
end;
$$;

revoke all on function public.repair_missing_publication_group(bigint, uuid)
from public, anon, authenticated;

grant execute on function public.repair_missing_publication_group(bigint, uuid)
to service_role;