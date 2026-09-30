
alter table public.bagaca_editorial_runs
  add column if not exists cycle_key text,
  add column if not exists current_stage text not null default 'research_r1',
  add column if not exists state_payload jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists bagaca_editorial_runs_cycle_key_key
  on public.bagaca_editorial_runs (cycle_key)
  where cycle_key is not null;

alter table public.bagaca_editorial_runs
  drop constraint if exists bagaca_editorial_runs_current_stage_check;

alter table public.bagaca_editorial_runs
  add constraint bagaca_editorial_runs_current_stage_check
  check (
    current_stage = any (
      array[
        'research_r1'::text,
        'process_r1'::text,
        'research_r2'::text,
        'process_r2'::text,
        'finalize'::text,
        'completed'::text,
        'failed'::text
      ]
    )
  );
;
