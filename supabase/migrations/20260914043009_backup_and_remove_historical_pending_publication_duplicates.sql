create table public.publicacoes_backup_dedup_20260914 as
with ranked as (
  select
    id,
    row_number() over (
      partition by noticia_id, caption
      order by criado_em desc, id desc
    ) as rn
  from public.publicacoes
  where status = 'AGUARDANDO_APROVACAO'
)
select
  p.*,
  now() as backup_created_at
from public.publicacoes p
join ranked r on r.id = p.id
where r.rn > 1
  and p.status = 'AGUARDANDO_APROVACAO'
  and p.approved_at is null
  and p.rejected_at is null
  and p.published_at is null
  and p.scheduled_at is null
  and coalesce(cardinality(p.selected_channels), 0) = 0
  and p.publication_group_id is null
  and p.idempotency_key is null
  and p.instagram_post_id is null
  and p.tiktok_post_id is null
  and p.youtube_video_id is null
  and p.instagram_url is null
  and p.facebook_url is null
  and p.tiktok_url is null
  and p.youtube_url is null
  and coalesce(p.publish_attempts, 0) = 0
  and p.last_error is null;

do $$
declare
  backup_count integer;
  deleted_count integer;
begin
  select count(*)
    into backup_count
  from public.publicacoes_backup_dedup_20260914;

  if backup_count <> 106 then
    raise exception 'Backup de deduplicacao esperava 106 registros, encontrou %.', backup_count;
  end if;

  delete from public.publicacoes p
  using public.publicacoes_backup_dedup_20260914 b
  where p.id = b.id
    and p.status = 'AGUARDANDO_APROVACAO'
    and p.approved_at is null
    and p.rejected_at is null
    and p.published_at is null
    and p.scheduled_at is null
    and coalesce(cardinality(p.selected_channels), 0) = 0
    and p.publication_group_id is null
    and p.idempotency_key is null
    and p.instagram_post_id is null
    and p.tiktok_post_id is null
    and p.youtube_video_id is null
    and p.instagram_url is null
    and p.facebook_url is null
    and p.tiktok_url is null
    and p.youtube_url is null
    and coalesce(p.publish_attempts, 0) = 0
    and p.last_error is null;

  get diagnostics deleted_count = row_count;

  if deleted_count <> backup_count then
    raise exception 'Deduplicacao esperava remover % registros, removeu %.', backup_count, deleted_count;
  end if;
end
$$;;
