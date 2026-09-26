-- Item 5: somente duas colunas opcionais para preservar os registros legados.
set local lock_timeout = '5s';
set local statement_timeout = '15s';

alter table public.noticias
  add column if not exists titulo_curto text,
  add column if not exists manchete_curta text;
