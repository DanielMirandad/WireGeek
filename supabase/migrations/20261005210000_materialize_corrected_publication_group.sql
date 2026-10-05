create or replace function public.materialize_corrected_publication_group(
  p_noticia_id bigint,
  p_requested_group_id uuid,
  p_editorials jsonb,
  p_cta_url text,
  p_hashtags text,
  p_banner_model_version text
)
returns setof public.publicacoes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
  v_groups uuid[];
  v_group_id uuid;
  v_total integer;
begin
  if p_noticia_id is null
     or p_requested_group_id is null
     or p_editorials is null
     or jsonb_typeof(p_editorials) <> 'array'
     or nullif(btrim(coalesce(p_cta_url, '')), '') is null
     or nullif(btrim(coalesce(p_banner_model_version, '')), '') is null then
    raise exception 'INVALID_MATERIALIZATION';
  end if;

  v_count := jsonb_array_length(p_editorials);

  if v_count not in (1, 2)
     or exists (
       select 1
       from jsonb_array_elements(p_editorials) e
       where coalesce(e->>'banner_url', '') !~ '^https://[^/@[:space:]]+/'
          or length(trim(coalesce(e->>'caption', ''))) not between 1 and 2200
     )
     or (
       v_count = 2
       and p_editorials->0->>'banner_url' =
           p_editorials->1->>'banner_url'
     )
     or p_cta_url !~ '^https://[^/@[:space:]]+/' then
    raise exception 'INVALID_EDITORIALS';
  end if;

  /*
   * Mesma chave usada por:
   * - auto_approve_publication_group
   * - apply_corrected_publication_banners
   *
   * Duas recuperacoes da mesma noticia nao podem
   * passar simultaneamente pela verificacao abaixo.
   */
  perform pg_advisory_xact_lock(p_noticia_id);

  /*
   * Historico publicado/rejeitado nao conta como
   * grupo ativo para esta recuperacao.
   */
  select array_agg(distinct publication_group_id)
    into v_groups
  from public.publicacoes
  where noticia_id = p_noticia_id
    and publication_group_id is not null
    and status in (
      'APROVADO',
      'AGUARDANDO_APROVACAO',
      'PUBLICANDO',
      'AGENDADO'
    );

  if coalesce(cardinality(v_groups), 0) > 1 then
    raise exception 'GROUP_UNSAFE_OR_AMBIGUOUS';
  end if;

  if coalesce(cardinality(v_groups), 0) = 1 then
    v_group_id := v_groups[1];

    perform 1
    from public.publicacoes
    where publication_group_id = v_group_id
    order by id
    for update;

    select count(*)
      into v_total
    from public.publicacoes
    where publication_group_id = v_group_id;

    if v_total not in (1, 2)
       or exists (
         select 1
         from public.publicacoes p
         where p.publication_group_id = v_group_id
           and (
             p.noticia_id <> p_noticia_id
             or p.carousel_position is null
             or p.carousel_position not between 1 and v_total
             or p.published_at is not null
             or p.status not in (
               'APROVADO',
               'AGUARDANDO_APROVACAO'
             )
             or p.instagram_status in (
               'PUBLICANDO',
               'PUBLICADO',
               'VERIFICAR_MANUALMENTE',
               'ERRO'
             )
             or p.instagram_post_id is not null
             or p.instagram_url is not null
             or p.idempotency_key is not null
             or p.publish_attempts <> 0
             or p.last_error is not null
             or p.youtube_status <> 'NAO_SELECIONADO'
             or p.youtube_video_id is not null
             or p.youtube_url is not null
             or p.facebook_url is not null
             or p.cta_url is distinct from p_cta_url
           )
       )
       or (
         select count(distinct carousel_position)
         from public.publicacoes
         where publication_group_id = v_group_id
       ) <> v_total then
      raise exception 'GROUP_UNSAFE_OR_AMBIGUOUS';
    end if;

    return query
      select *
      from public.publicacoes
      where publication_group_id = v_group_id
      order by carousel_position;

    return;
  end if;

  /*
   * Nenhum grupo ativo existe.
   * Todas as linhas nascem na mesma transacao.
   */
  insert into public.publicacoes(
    noticia_id,
    publication_group_id,
    carousel_position,
    banner_url,
    caption,
    hashtags,
    cta_url,
    banner_model_version,
    status
  )
  select
    p_noticia_id,
    p_requested_group_id,
    x.ordinality::integer,
    x.editorial->>'banner_url',
    x.editorial->>'caption',
    p_hashtags,
    p_cta_url,
    p_banner_model_version,
    'AGUARDANDO_APROVACAO'
  from jsonb_array_elements(p_editorials)
       with ordinality as x(editorial, ordinality);

  return query
    select *
    from public.publicacoes
    where publication_group_id = p_requested_group_id
    order by carousel_position;
end;
$$;

revoke all on function public.materialize_corrected_publication_group(
  bigint,
  uuid,
  jsonb,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.materialize_corrected_publication_group(
  bigint,
  uuid,
  jsonb,
  text,
  text,
  text
) to service_role;