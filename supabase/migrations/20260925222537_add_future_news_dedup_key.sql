-- Prevent future exact URL duplicates without changing legacy rows.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.noticias
  add column if not exists dedup_key text;

create unique index if not exists noticias_dedup_key_unique
  on public.noticias (dedup_key)
  where dedup_key is not null;
