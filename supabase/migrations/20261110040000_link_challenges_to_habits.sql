begin;

alter table public.planner_challenges
  add column habit_id text,
  add constraint planner_challenges_habit_type_fkey
    foreign key (user_id, habit_id) references public.planner_habit_types (user_id, id);

create or replace function planner_private.check_challenge_checkin_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  challenge_start date;
  challenge_habit_id text;
begin
  if new.checkin_date > (statement_timestamp() at time zone 'Asia/Shanghai')::date then
    raise exception 'Challenge check-in date cannot be in the future' using errcode = '23514';
  end if;

  select start_date, habit_id into challenge_start, challenge_habit_id
  from public.planner_challenges
  where user_id = new.user_id and id = new.challenge_id;

  if challenge_habit_id is not null then
    raise exception 'This challenge uses regular habit check-ins' using errcode = '23514';
  end if;
  if new.checkin_date < challenge_start then
    raise exception 'Check-in date cannot precede the challenge start date' using errcode = '23514';
  end if;
  return new;
end;
$$;

commit;
