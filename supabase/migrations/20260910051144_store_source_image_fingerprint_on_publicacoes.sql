alter table public.publicacoes
  add column if not exists source_image_url text,
  add column if not exists source_image_full_hash text,
  add column if not exists source_image_crop_hash text;
