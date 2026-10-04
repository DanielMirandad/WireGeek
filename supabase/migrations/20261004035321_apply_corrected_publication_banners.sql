-- Local only. Atomic cardinality changes and asset revision cannot be implemented
-- safely as independent REST writes. Existing group IDs and row 1 are retained.
alter table public.publicacoes add column if not exists reel_asset_revision uuid;

create or replace function public.apply_corrected_publication_banners(
  p_group_id uuid, p_noticia_id bigint, p_expected jsonb,
  p_editorials jsonb, p_revision uuid
)
returns setof public.publicacoes
language plpgsql security invoker set search_path = public
as $$
declare
  v_first public.publicacoes%rowtype;
  v_total integer;
  v_count integer;
  v_snapshot jsonb;
  v_row record;
  v_editorial jsonb;
begin
  if p_group_id is null or p_revision is null or p_noticia_id is null
     or p_editorials is null or p_expected is null
     or jsonb_typeof(p_editorials) <> 'array'
     or jsonb_typeof(p_expected) <> 'array' then
    raise exception 'INVALID_CORRECTION';
  end if;
  v_count := jsonb_array_length(p_editorials);
  if v_count not in (1,2) or exists (
    select 1 from jsonb_array_elements(p_editorials) e
    where coalesce(e->>'banner_url','') !~ '^https://[^/@[:space:]]+/'
       or length(trim(coalesce(e->>'caption',''))) not between 1 and 2200
  ) or (v_count = 2 and p_editorials->0->>'banner_url' = p_editorials->1->>'banner_url') then
    raise exception 'INVALID_EDITORIALS';
  end if;

  -- Same key and lock order as auto_approve_publication_group.
  perform pg_advisory_xact_lock(p_noticia_id);

  -- Same row locks/order as reserve_publication_group; serializes publish/correction.
  perform 1 from public.publicacoes where publication_group_id = p_group_id order by id for update;
  select * into v_first from public.publicacoes
    where publication_group_id = p_group_id and carousel_position = 1;
  select count(*) into v_total from public.publicacoes where publication_group_id = p_group_id;
  if v_first.id is null or v_total not in (1,2) or exists (
    select 1 from public.publicacoes p where p.publication_group_id = p_group_id and (
      p.noticia_id <> p_noticia_id or p.carousel_position not between 1 and v_total
      or p.carousel_position is null or p.published_at is not null
      or p.status not in ('APROVADO','AGUARDANDO_APROVACAO')
      or p.instagram_status in ('PUBLICANDO','PUBLICADO','VERIFICAR_MANUALMENTE','ERRO')
      or p.instagram_post_id is not null or p.instagram_url is not null
      or p.idempotency_key is not null or p.publish_attempts <> 0 or p.last_error is not null
      -- Do not change a group already in use by another publication integration.
      or p.youtube_status <> 'NAO_SELECIONADO' or p.youtube_video_id is not null
      or p.youtube_url is not null or p.facebook_url is not null
      or p.cta_url is distinct from v_first.cta_url
    )
  ) or (select count(distinct carousel_position) from public.publicacoes where publication_group_id=p_group_id) <> v_total
     or exists (select 1 from public.publicacoes where noticia_id=p_noticia_id
       and publication_group_id is distinct from p_group_id
       and status in ('APROVADO','AGUARDANDO_APROVACAO','PUBLICANDO','AGENDADO')) then
    raise exception 'GROUP_UNSAFE_OR_AMBIGUOUS';
  end if;

  if v_total = 2 and v_count = 1 then
    raise exception 'EDITORIAL_REDUCTION_NOT_SUPPORTED: 2 -> 1 bloqueado nesta versao';
  end if;
  if nullif(btrim(v_first.cta_url), '') is null then
    raise exception 'INVALID_SHARED_CTA';
  end if;

  -- A confirmed duplicate request returns the same rows, without resetting approval
  -- or invalidating an already prepared container a second time.
  if v_total = v_count and not exists (
    select 1 from public.publicacoes p where p.publication_group_id=p_group_id and (
      p.reel_asset_revision is distinct from p_revision
      or p.banner_url is distinct from (p_editorials->(p.carousel_position-1)->>'banner_url')
      or p.caption is distinct from (p_editorials->(p.carousel_position-1)->>'caption')
    )
  ) then
    return query select * from public.publicacoes where publication_group_id=p_group_id order by carousel_position;
    return;
  end if;

  select jsonb_agg(jsonb_build_object(
    'id',p.id,'banner_url',p.banner_url,'cta_url',p.cta_url,'status',p.status,
    'atualizado_em',p.atualizado_em,'reel_asset_revision',p.reel_asset_revision,
    'instagram_parent_container_id',p.instagram_parent_container_id,
    'selected_channels',p.selected_channels,'scheduled_at',p.scheduled_at,
    'hashtags',p.hashtags,'banner_model_version',p.banner_model_version
  ) order by p.carousel_position) into v_snapshot
  from public.publicacoes p where p.publication_group_id=p_group_id;
  -- Compare timestamps as instants (PostgREST may use a different UTC spelling).
  if jsonb_array_length(p_expected) <> v_total then raise exception 'STALE_GROUP'; end if;
  for v_row in select value, ordinality from jsonb_array_elements(v_snapshot) with ordinality loop
    if (v_row.value - 'atualizado_em' - 'scheduled_at') is distinct from ((p_expected->(v_row.ordinality::int-1)) - 'atualizado_em' - 'scheduled_at')
       or (v_row.value->>'scheduled_at')::timestamptz is distinct from
          (p_expected->(v_row.ordinality::int-1)->>'scheduled_at')::timestamptz
       or (v_row.value->>'atualizado_em')::timestamptz is distinct from
          (p_expected->(v_row.ordinality::int-1)->>'atualizado_em')::timestamptz then
      raise exception 'STALE_GROUP';
    end if;
  end loop;

  -- Cardinality adjustment happens within this transaction; no partial group is visible.
  if v_total = 1 and v_count = 2 then
    insert into public.publicacoes(noticia_id,publication_group_id,carousel_position,
      banner_url,caption,hashtags,cta_url,banner_model_version,selected_channels,scheduled_at,status)
    values(p_noticia_id,p_group_id,2,p_editorials->1->>'banner_url',p_editorials->1->>'caption',
      v_first.hashtags,v_first.cta_url,v_first.banner_model_version,
      v_first.selected_channels,v_first.scheduled_at,'AGUARDANDO_APROVACAO');
  end if;
  update public.publicacoes p set
    banner_url=p_editorials->(p.carousel_position-1)->>'banner_url',
    caption=p_editorials->(p.carousel_position-1)->>'caption',
    source_image_url=null,source_image_full_hash=null,source_image_crop_hash=null,
    reel_asset_revision=p_revision,status='AGUARDANDO_APROVACAO',approved_at=null,rejected_at=null,
    instagram_parent_container_id=null,instagram_child_container_ids=array[]::text[],
    instagram_containers_created_at=null,instagram_caption_sha256=null,
    instagram_status='NAO_SELECIONADO',atualizado_em=now()
  where p.publication_group_id=p_group_id;
  return query select * from public.publicacoes where publication_group_id=p_group_id order by carousel_position;
end;
$$;
revoke all on function public.apply_corrected_publication_banners(uuid,bigint,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.apply_corrected_publication_banners(uuid,bigint,jsonb,jsonb,uuid) to service_role;
