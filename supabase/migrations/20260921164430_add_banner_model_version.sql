alter table public.publicacoes
add column if not exists banner_model_version text;

comment on column public.publicacoes.banner_model_version is
'Identifica a versÃ£o imutÃ¡vel do modelo visual usada para gerar o grupo de banners. NULL indica geraÃ§Ã£o histÃ³rica/legacy.';