alter table public.publicacoes
  add column if not exists carousel_position smallint,
  add column if not exists cta_url text;
