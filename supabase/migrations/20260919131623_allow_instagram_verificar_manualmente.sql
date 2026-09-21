alter table public.publicacoes
drop constraint if exists publicacoes_instagram_status_check;

alter table public.publicacoes
add constraint publicacoes_instagram_status_check
check (
  instagram_status = any (
    array[
      'NAO_SELECIONADO'::text,
      'AGUARDANDO'::text,
      'PUBLICANDO'::text,
      'PUBLICADO'::text,
      'ERRO'::text,
      'VERIFICAR_MANUALMENTE'::text
    ]
  )
);