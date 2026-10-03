-- Only validated generation outputs. Inputs are represented solely by SHA-256.
create table public.openai_generation_cache (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  namespace text not null check (namespace in ('site-editorial', 'briefing-vision', 'banner-title')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (namespace, key_hash),
  check (expires_at > created_at)
);
create index openai_generation_cache_expires_at_idx on public.openai_generation_cache (expires_at);
alter table public.openai_generation_cache enable row level security;
revoke all on public.openai_generation_cache from public, anon, authenticated;
grant select, insert, update, delete on public.openai_generation_cache to service_role;
comment on table public.openai_generation_cache is 'Backend-only cache of validated outputs. Never store prompts, raw images, credentials or secrets.';
