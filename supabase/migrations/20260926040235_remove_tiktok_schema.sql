-- Remove the retired TikTok integration from the active database schema.

drop table if exists public.wiregeek_tiktok_uploads;
drop table if exists public.wiregeek_tiktok_oauth;
drop table if exists public.wiregeek_tiktok_channels;

alter table public.publicacoes
  drop column if exists tiktok_status,
  drop column if exists tiktok_post_id,
  drop column if exists tiktok_url;

alter table public.publicacoes_backup_dedup_20260914
  drop column if exists tiktok_status,
  drop column if exists tiktok_post_id,
  drop column if exists tiktok_url;
