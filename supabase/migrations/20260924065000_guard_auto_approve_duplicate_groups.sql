create or replace function public.auto_approve_publication_group(
  p_group_id uuid,
  p_noticia_id bigint
)
returns setof public.publicacoes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total integer;
  v_position_1 integer;
  v_position_2 integer;
  v_same_news integer;
  v_ready integer;
  v_safe_instagram integer;
  v_updated integer;
  v_existing_active_groups integer;
begin
  /*
   * Serializa a auto-aprovacao por noticia.
   *
   * Duas geracoes concorrentes da mesma noticia
   * nao podem aprovar dois grupos diferentes.
   */
  perform pg_advisory_xact_lock(
    p_noticia_id
  );

  /*
   * Trava as linhas do grupo atual.
   */
  perform 1
  from public.publicacoes
  where publication_group_id = p_group_id
  order by id
  for update;

  /*
   * DUPLICATE GUARD.
   *
   * Qualquer OUTRO grupo da mesma noticia que
   * ja tenha avancado no ciclo editorial/Instagram
   * impede a auto-aprovacao deste novo grupo.
   *
   * REJEITADO sem evidencia de Instagram nao bloqueia.
   * Um grupo meramente pendente tambem nao bloqueia.
   */
  select
    count(
      distinct publication_group_id
    )

  into
    v_existing_active_groups

  from public.publicacoes
  where noticia_id = p_noticia_id
    and publication_group_id is not null
    and publication_group_id <> p_group_id
    and (
      status in (
        'APROVADO',
        'PUBLICANDO',
        'PUBLICADO'
      )

      or published_at is not null

      or nullif(
        trim(
          coalesce(
            instagram_post_id,
            ''
          )
        ),
        ''
      ) is not null

      or nullif(
        trim(
          coalesce(
            instagram_parent_container_id,
            ''
          )
        ),
        ''
      ) is not null

      or coalesce(
        cardinality(
          instagram_child_container_ids
        ),
        0
      ) > 0

      or coalesce(
        publish_attempts,
        0
      ) > 0

      or nullif(
        trim(
          coalesce(
            idempotency_key,
            ''
          )
        ),
        ''
      ) is not null

      or instagram_status in (
        'PUBLICANDO',
        'VERIFICAR_MANUALMENTE',
        'PUBLICADO'
      )
    );

  if
    v_existing_active_groups > 0
  then
    /*
     * Retorno vazio e deliberado.
     *
     * Nenhuma linha do grupo novo e aprovada.
     */
    return;
  end if;

  select
    count(*),

    count(*) filter (
      where carousel_position = 1
    ),

    count(*) filter (
      where carousel_position = 2
    ),

    count(*) filter (
      where noticia_id = p_noticia_id
    ),

    count(*) filter (
      where
        status = 'AGUARDANDO_APROVACAO'
        and published_at is null
        and instagram_post_id is null
    ),

    count(*) filter (
      where
        instagram_status = 'NAO_SELECIONADO'
        and instagram_parent_container_id is null
        and coalesce(
          cardinality(
            instagram_child_container_ids
          ),
          0
        ) = 0
        and publish_attempts = 0
        and idempotency_key is null
    )

  into
    v_total,
    v_position_1,
    v_position_2,
    v_same_news,
    v_ready,
    v_safe_instagram

  from public.publicacoes
  where publication_group_id = p_group_id;

  if
    v_total <> 2
    or v_position_1 <> 1
    or v_position_2 <> 1
    or v_same_news <> 2
    or v_ready <> 2
    or v_safe_instagram <> 2
  then
    return;
  end if;

  update public.publicacoes
  set
    status = 'APROVADO',
    approved_at = now(),
    rejected_at = null,
    atualizado_em = now()
  where publication_group_id = p_group_id
    and noticia_id = p_noticia_id
    and status = 'AGUARDANDO_APROVACAO'
    and published_at is null
    and instagram_post_id is null
    and instagram_status = 'NAO_SELECIONADO'
    and instagram_parent_container_id is null
    and coalesce(
      cardinality(
        instagram_child_container_ids
      ),
      0
    ) = 0
    and publish_attempts = 0
    and idempotency_key is null;

  get diagnostics
    v_updated = row_count;

  if v_updated <> 2 then
    raise exception
      'Nao foi possivel auto-aprovar atomicamente os dois editoriais.';
  end if;

  return query
  select p.*
  from public.publicacoes p
  where p.publication_group_id = p_group_id
    and p.noticia_id = p_noticia_id
  order by p.carousel_position;
end;
$$;

revoke all
on function public.auto_approve_publication_group(uuid, bigint)
from public;

revoke all
on function public.auto_approve_publication_group(uuid, bigint)
from anon;

revoke all
on function public.auto_approve_publication_group(uuid, bigint)
from authenticated;

grant execute
on function public.auto_approve_publication_group(uuid, bigint)
to service_role;