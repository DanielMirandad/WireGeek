set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table public.editorial_executions (
  id uuid primary key,
  source text not null check (source in ('manual','cron','import')),
  slot text,
  status text not null check (status in ('running','completed','no_candidates','no_new_stories','invalid','failed','expired','skipped_busy','skipped_duplicate')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  researched integer not null default 0 check (researched >= 0),
  approved integer not null default 0 check (approved >= 0),
  persisted integer not null default 0 check (persisted >= 0),
  error_code text
);
create unique index editorial_executions_cron_slot_unique on public.editorial_executions(slot)
  where source='cron' and status not in ('skipped_busy','skipped_duplicate');
create index editorial_executions_started_at_idx on public.editorial_executions(started_at desc);
create table public.editorial_execution_lock (
  name text primary key check (name='news'),
  owner_id uuid references public.editorial_executions(id),
  expires_at timestamptz
);
insert into public.editorial_execution_lock(name) values ('news');
alter table public.editorial_executions enable row level security;
alter table public.editorial_execution_lock enable row level security;
revoke all on public.editorial_executions, public.editorial_execution_lock from public, anon, authenticated, service_role;
grant select, insert, update on public.editorial_executions, public.editorial_execution_lock to service_role;

create function public.begin_editorial_execution(p_id uuid, p_source text, p_slot text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_lock public.editorial_execution_lock; outcome text;
begin
  if p_source not in ('manual','cron','import') or p_id is null then raise exception 'INVALID_EXECUTION'; end if;
  if p_source='cron' and (p_slot is null or length(p_slot)>80) then raise exception 'INVALID_SLOT'; end if;
  select * into strict current_lock from public.editorial_execution_lock where name='news' for update;
  if current_lock.owner_id is not null and current_lock.expires_at <= clock_timestamp() then
    update public.editorial_executions set status='expired', finished_at=clock_timestamp(), error_code='LEASE_EXPIRED'
      where id=current_lock.owner_id and status='running';
  end if;
  if p_source='cron' and exists(select 1 from public.editorial_executions
      where source='cron' and slot=p_slot and status not in ('skipped_busy','skipped_duplicate')) then
    outcome := 'skipped_duplicate';
  elsif current_lock.owner_id is not null and current_lock.expires_at > clock_timestamp() then outcome := 'skipped_busy';
  else outcome := 'running'; end if;
  insert into public.editorial_executions(id, source, slot, status, finished_at)
    values(p_id,p_source,case when p_source='cron' then p_slot end,outcome,case when outcome<>'running' then clock_timestamp() end);
  if outcome='running' then
    -- Lease exceeds the configured 300s hard function duration.
    update public.editorial_execution_lock set owner_id=p_id, expires_at=clock_timestamp()+interval '10 minutes' where name='news';
  end if;
  return jsonb_build_object('id',p_id,'acquired',outcome='running','status',outcome);
end $$;

create function public.progress_editorial_execution(p_id uuid, p_researched integer default null, p_approved integer default null, p_persisted integer default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.editorial_execution_lock where name='news' and owner_id=p_id and expires_at>clock_timestamp() for update;
  if not found then raise exception 'EXECUTION_LEASE_LOST'; end if;
  update public.editorial_executions set researched=coalesce(p_researched,researched), approved=coalesce(p_approved,approved), persisted=coalesce(p_persisted,persisted)
    where id=p_id and status='running';
  if not found then raise exception 'EXECUTION_NOT_RUNNING'; end if;
  return true;
end $$;

create function public.finish_editorial_execution(p_id uuid, p_status text, p_error_code text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_status not in ('completed','no_candidates','no_new_stories','invalid','failed') then raise exception 'INVALID_RESULT'; end if;
  perform 1 from public.editorial_execution_lock where name='news' and owner_id=p_id and expires_at>clock_timestamp() for update;
  if not found then raise exception 'EXECUTION_LEASE_LOST'; end if;
  update public.editorial_executions set status=p_status, finished_at=clock_timestamp(),error_code=left(p_error_code,80) where id=p_id and status='running';
  if not found then raise exception 'EXECUTION_NOT_RUNNING'; end if;
  update public.editorial_execution_lock set owner_id=null, expires_at=null where name='news' and owner_id=p_id;
  return true;
end $$;
revoke all on function public.begin_editorial_execution(uuid,text,text), public.progress_editorial_execution(uuid,integer,integer,integer), public.finish_editorial_execution(uuid,text,text) from public,anon,authenticated;
grant execute on function public.begin_editorial_execution(uuid,text,text), public.progress_editorial_execution(uuid,integer,integer,integer), public.finish_editorial_execution(uuid,text,text) to service_role;

-- Supabase schedules the request; Vercel Hobby only hosts the protected endpoint.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create table public.editorial_cron_dispatches (
  request_id bigint primary key,
  dispatched_at timestamptz not null default clock_timestamp()
);
alter table public.editorial_cron_dispatches enable row level security;
revoke all on public.editorial_cron_dispatches from public, anon, authenticated, service_role;
grant select on public.editorial_cron_dispatches to service_role;

create function public.dispatch_wiregeek_news()
returns bigint language plpgsql security invoker set search_path='' as $$
declare cron_secret text; request_id bigint;
begin
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name='wiregeek_cron_secret';
  if cron_secret is null or length(trim(cron_secret))=0 then
    raise exception 'CRON_SECRET_NOT_CONFIGURED';
  end if;
  select net.http_post(
    url := 'https://wiregeek.vercel.app/api/cron-news',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || trim(cron_secret)),
    body := '{}'::jsonb,
    timeout_milliseconds := 310000
  ) into request_id;
  insert into public.editorial_cron_dispatches(request_id) values(request_id);
  return request_id;
end $$;
revoke all on function public.dispatch_wiregeek_news() from public, anon, authenticated, service_role;

-- Creation and deactivation commit together. Activation is reserved for Item 14,
-- after the new endpoint is deployed and authenticated requests are verified.
do $$
declare scheduled_job bigint;
begin
  scheduled_job := cron.schedule('wiregeek-social-every-2h', '0 */2 * * *', 'select public.dispatch_wiregeek_news();');
  perform cron.alter_job(scheduled_job, active := false);
end $$;
