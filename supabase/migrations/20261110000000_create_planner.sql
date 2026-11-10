begin;

create schema planner_private;
revoke all on schema planner_private from public, anon, authenticated, service_role;
grant usage on schema planner_private to authenticated;

create table planner_private.owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users (id) on delete cascade
);
revoke all on table planner_private.owner from public, anon, authenticated, service_role;

create function planner_private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from planner_private.owner
    where user_id = (select auth.uid())
  );
$$;
revoke all on function planner_private.is_owner() from public, anon, authenticated, service_role;
grant execute on function planner_private.is_owner() to authenticated;

create function public.planner_has_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select planner_private.is_owner();
$$;
revoke all on function public.planner_has_access() from public, anon, authenticated, service_role;
grant execute on function public.planner_has_access() to authenticated;

create table public.planner_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_date date not null check (isfinite(event_date)),
  activity text not null check (activity in ('piano', 'practice', 'strength')),
  start_minute smallint not null,
  end_minute smallint not null,
  work_exception boolean not null default false,
  constraint planner_event_time check (start_minute >= 0 and end_minute > start_minute and end_minute <= 1440),
  constraint planner_work_exception check (
    work_exception = (
      extract(isodow from event_date) between 1 and 5
      and (
        (start_minute < 690 and end_minute > 570)
        or (start_minute < 1080 and end_minute > 780)
      )
    )
  )
);

create index planner_events_owner_date_idx on public.planner_events (user_id, event_date, start_minute, id);

alter table public.planner_events enable row level security;
revoke all on table public.planner_events from public, anon, authenticated, service_role;
grant select, insert, delete on table public.planner_events to authenticated;
grant update (event_date, activity, start_minute, end_minute, work_exception)
  on table public.planner_events to authenticated;

create policy planner_events_owner
on public.planner_events
for all
to authenticated
using ((select planner_private.is_owner()) and user_id = (select auth.uid()))
with check ((select planner_private.is_owner()) and user_id = (select auth.uid()));

create table public.planner_checkins (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  checkin_date date not null check (isfinite(checkin_date)),
  habit text not null check (habit in ('steps', 'reading')),
  primary key (user_id, checkin_date, habit)
);

create function planner_private.check_checkin_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.checkin_date > (statement_timestamp() at time zone 'Asia/Shanghai')::date then
    raise exception 'Check-in date cannot be in the future' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function planner_private.check_checkin_date() from public, anon, authenticated, service_role;

create trigger planner_checkins_date
before insert or update on public.planner_checkins
for each row execute function planner_private.check_checkin_date();

alter table public.planner_checkins enable row level security;
revoke all on table public.planner_checkins from public, anon, authenticated, service_role;
grant select, insert, delete on table public.planner_checkins to authenticated;

create policy planner_checkins_owner
on public.planner_checkins
for all
to authenticated
using ((select planner_private.is_owner()) and user_id = (select auth.uid()))
with check ((select planner_private.is_owner()) and user_id = (select auth.uid()));

commit;
