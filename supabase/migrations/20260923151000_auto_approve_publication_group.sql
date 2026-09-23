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
begin
  /*
   * Trava as linhas do grupo enquanto validamos
   * e aprovamos os dois editoriais.
   */
  perform 1
  from public.publicacoes
  where publication_group_id = p_group_id
  order by id
  for update;

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
          cardinality(instagram_child_container_ids),
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

  /*
   * Nada e aprovado parcialmente.
   *
   * O grupo precisa possuir exatamente:
   * - 2 registros;
   * - posicoes 1 e 2;
   * - mesma noticia;
   * - ambos pendentes;
   * - nenhum vestigio de publicacao Instagram.
   */
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
      cardinality(instagram_child_container_ids),
      0
    ) = 0
    and publish_attempts = 0
    and idempotency_key is null;

  get diagnostics v_updated = row_count;

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