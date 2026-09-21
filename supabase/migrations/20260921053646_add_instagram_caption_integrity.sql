alter table public.publicacoes
  add column if not exists instagram_caption_sha256 text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'publicacoes_instagram_caption_sha256_format_ck'
      and conrelid = 'public.publicacoes'::regclass
  ) then
    alter table public.publicacoes
      add constraint publicacoes_instagram_caption_sha256_format_ck
      check (
        instagram_caption_sha256 is null
        or instagram_caption_sha256 ~ '^[0-9a-f]{64}$'
      );
  end if;
end
$$;

comment on column public.publicacoes.instagram_caption_sha256 is
  'SHA-256 da legenda exata enviada na criacao do container Instagram Reel. Usado para bloquear publicacao de container com legenda divergente.';
