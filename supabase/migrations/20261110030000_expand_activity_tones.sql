begin;

alter table public.planner_activity_types
  drop constraint planner_activity_types_tone_check,
  add constraint planner_activity_types_tone_check
    check (tone in ('purple', 'blue', 'orange', 'pink', 'teal', 'green', 'yellow'));

commit;
