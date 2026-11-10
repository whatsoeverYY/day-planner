begin;

create table public.planner_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80 and title ~ '[^[:space:]]'),
  target_days integer not null check (target_days between 1 and 3650),
  start_date date not null check (start_date between date '0001-01-01' and date '9999-12-31'),
  unique (user_id, id)
);

alter table public.planner_challenges enable row level security;
revoke all on table public.planner_challenges from public, anon, authenticated, service_role;
grant select, insert, delete on table public.planner_challenges to authenticated;

create policy planner_challenges_owner
on public.planner_challenges
for all
to authenticated
using ((select planner_private.is_owner()) and user_id = (select auth.uid()))
with check ((select planner_private.is_owner()) and user_id = (select auth.uid()));

create table public.planner_challenge_checkins (
  user_id uuid not null default auth.uid(),
  challenge_id uuid not null,
  checkin_date date not null check (checkin_date between date '0001-01-01' and date '9999-12-31'),
  primary key (user_id, challenge_id, checkin_date),
  foreign key (user_id, challenge_id) references public.planner_challenges (user_id, id) on delete cascade
);

create function planner_private.check_challenge_checkin_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  challenge_start date;
begin
  if new.checkin_date > (statement_timestamp() at time zone 'Asia/Shanghai')::date then
    raise exception 'Challenge check-in date cannot be in the future' using errcode = '23514';
  end if;

  select start_date into challenge_start
  from public.planner_challenges
  where user_id = new.user_id and id = new.challenge_id;

  if new.checkin_date < challenge_start then
    raise exception 'Check-in date cannot precede the challenge start date' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function planner_private.check_challenge_checkin_date() from public, anon, authenticated, service_role;

create trigger planner_challenge_checkins_date
before insert or update on public.planner_challenge_checkins
for each row execute function planner_private.check_challenge_checkin_date();

alter table public.planner_challenge_checkins enable row level security;
revoke all on table public.planner_challenge_checkins from public, anon, authenticated, service_role;
grant select, insert, delete on table public.planner_challenge_checkins to authenticated;

create policy planner_challenge_checkins_owner
on public.planner_challenge_checkins
for all
to authenticated
using ((select planner_private.is_owner()) and user_id = (select auth.uid()))
with check ((select planner_private.is_owner()) and user_id = (select auth.uid()));

commit;
