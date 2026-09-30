
create table if not exists public.community_questions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text null,
  type text not null,
  message text not null,
  can_quote_name boolean not null default true,
  status text not null default 'pending',
  ip_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint community_questions_name_len
    check (char_length(trim(name)) between 2 and 80),

  constraint community_questions_email_len
    check (email is null or char_length(email) <= 254),

  constraint community_questions_type_check
    check (type in ('question', 'topic', 'comment', 'other')),

  constraint community_questions_message_len
    check (char_length(trim(message)) between 10 and 3000),

  constraint community_questions_status_check
    check (status in ('pending', 'approved', 'used', 'archived', 'rejected')),

  constraint community_questions_ip_hash_check
    check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')
);

alter table public.community_questions
  enable row level security;

create index if not exists community_questions_created_at_idx
  on public.community_questions (created_at desc);

create index if not exists community_questions_status_created_at_idx
  on public.community_questions (status, created_at desc);

create index if not exists community_questions_ip_hash_created_at_idx
  on public.community_questions (ip_hash, created_at desc);

comment on table public.community_questions is
  'Perguntas e mensagens enviadas pela comunidade do Bagaça Studios. Escrita apenas pelo backend com service role.';

comment on column public.community_questions.ip_hash is
  'SHA-256 do IP normalizado para rate limit; não armazena o IP em texto claro.';
;
