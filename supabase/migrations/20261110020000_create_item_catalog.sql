begin;

create table public.planner_activity_types (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null default gen_random_uuid()::text check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  name text not null check (char_length(name) between 1 and 80 and name ~ '[^[:space:]]'),
  tone text not null check (tone in ('purple', 'blue', 'orange')),
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, id)
);

alter table public.planner_activity_types enable row level security;
revoke all on table public.planner_activity_types from public, anon, authenticated, service_role;
grant select on table public.planner_activity_types to authenticated;
grant insert (user_id, id, name, tone), update (name, tone)
  on table public.planner_activity_types to authenticated;

create policy planner_activity_types_owner
on public.planner_activity_types
for all
to authenticated
using ((select planner_private.is_owner()) and user_id = (select auth.uid()))
with check ((select planner_private.is_owner()) and user_id = (select auth.uid()));

create table public.planner_habit_types (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null default gen_random_uuid()::text check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  name text not null check (char_length(name) between 1 and 80 and name ~ '[^[:space:]]'),
  start_date date not null default ((statement_timestamp() at time zone 'Asia/Shanghai')::date)
    check (start_date between date '0001-01-01' and date '9999-12-31'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, id)
);

alter table public.planner_habit_types enable row level security;
revoke all on table public.planner_habit_types from public, anon, authenticated, service_role;
grant select on table public.planner_habit_types to authenticated;
grant insert (user_id, id, name), update (name)
  on table public.planner_habit_types to authenticated;

create policy planner_habit_types_owner
on public.planner_habit_types
for all
to authenticated
using ((select planner_private.is_owner()) and user_id = (select auth.uid()))
with check ((select planner_private.is_owner()) and user_id = (select auth.uid()));

create function planner_private.seed_item_catalog(target_user uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.planner_activity_types (user_id, id, name, tone) values
    (target_user, 'piano', '钢琴课', 'purple'),
    (target_user, 'practice', '钢琴练习', 'blue'),
    (target_user, 'strength', '无氧训练', 'orange')
  on conflict (user_id, id) do nothing;

  insert into public.planner_habit_types (user_id, id, name, start_date) values
    (target_user, 'steps', '6000 步', date '0001-01-01'),
    (target_user, 'reading', '阅读', date '0001-01-01')
  on conflict (user_id, id) do nothing;
$$;
revoke all on function planner_private.seed_item_catalog(uuid) from public, anon, authenticated, service_role;

select planner_private.seed_item_catalog(affected.user_id)
from (
  select user_id from planner_private.owner
  union
  select user_id from public.planner_events
  union
  select user_id from public.planner_checkins
) as affected;

create function planner_private.seed_owner_item_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform planner_private.seed_item_catalog(new.user_id);
  return new;
end;
$$;
revoke all on function planner_private.seed_owner_item_catalog() from public, anon, authenticated, service_role;

create trigger planner_owner_item_catalog
after insert or update of user_id on planner_private.owner
for each row execute function planner_private.seed_owner_item_catalog();

alter table public.planner_events
  drop constraint planner_events_activity_check,
  add constraint planner_events_activity_type_fkey
    foreign key (user_id, activity) references public.planner_activity_types (user_id, id);

alter table public.planner_checkins
  drop constraint planner_checkins_habit_check,
  add constraint planner_checkins_habit_type_fkey
    foreign key (user_id, habit) references public.planner_habit_types (user_id, id);

create or replace function planner_private.check_checkin_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  habit_start date;
begin
  if new.checkin_date > (statement_timestamp() at time zone 'Asia/Shanghai')::date then
    raise exception 'Check-in date cannot be in the future' using errcode = '23514';
  end if;

  select start_date into habit_start
  from public.planner_habit_types
  where user_id = new.user_id and id = new.habit;

  if new.checkin_date < habit_start then
    raise exception 'Check-in date cannot precede the habit start date' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function planner_private.check_checkin_date() from public, anon, authenticated, service_role;

commit;
