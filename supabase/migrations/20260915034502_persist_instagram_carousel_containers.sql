alter table public.publicacoes
  add column if not exists instagram_parent_container_id text,
  add column if not exists instagram_child_container_ids text[],
  add column if not exists instagram_containers_created_at timestamptz;