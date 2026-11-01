-- Guided test run (guides walkthrough, Nov 2026). Creates clearly-labelled
-- test data; remove it all with test_run_cleanup.sql afterwards.
--   * location "TEST LOCATION" (so nothing touches real sessions)
--   * TEST COACH switched back on, with a $50/hr Town Session rate
--   * TEST SCHEDULER (schupp.14+scheduler@gmail.com) managing
--     Town Session at TEST LOCATION only
--   * five "TEST -" Town Session sessions, 5:00-6:00 PM:
--       yesterday   -> TEST COACH  (coach: Confirm hours)
--       +2 days     -> TEST COACH  (coach: I'll be there, Request swap)
--       +3 days     -> TEST COACH  (scheduler: Sub)
--       +4 days     -> TEST COACH  (scheduler: Cancel session)
--       +5 days     -> nobody      (scheduler: + Assign, routine)
-- Ends with a summary row so you can see what was made.
do $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_prog uuid := (select id from programs where name in ('Town Session', 'Town Sessions') order by name limit 1);
  v_coach uuid := (select id from coaches where name = 'TEST COACH');
  v_loc uuid;
  v_sched uuid;
  v_ev uuid;
  v_day int;
  v_label text;
begin
  if v_prog is null then raise exception 'No Town Session program found.'; end if;
  if v_coach is null then raise exception 'No TEST COACH on the roster.'; end if;
  if exists (select 1 from events where session_name like 'TEST -%') then
    raise exception 'Test sessions already exist -- run test_run_cleanup.sql first.';
  end if;

  insert into locations (name, category) values ('TEST LOCATION', 'regular')
    on conflict (name) do update set is_active = true
    returning id into v_loc;

  update coaches set is_active = true where id = v_coach;
  insert into rates (coach_id, program_id, rate) values (v_coach, v_prog, 50);

  insert into schedulers (name, email) values ('TEST SCHEDULER', 'schupp.14+scheduler@gmail.com')
    on conflict (email) do update set is_active = true, name = 'TEST SCHEDULER'
    returning id into v_sched;
  insert into scheduler_scopes (scheduler_id, program_id, location_id) values (v_sched, v_prog, v_loc);

  foreach v_day in array array[-1, 2, 3, 4, 5] loop
    v_label := case v_day
      when -1 then 'TEST - confirm hours'
      when 2 then 'TEST - I''ll be there / swap'
      when 3 then 'TEST - scheduler sub'
      when 4 then 'TEST - scheduler cancel'
      else 'TEST - unstaffed' end;
    insert into events (program_id, location_id, event_date, start_time, end_time, session_name)
      values (v_prog, v_loc, v_today + v_day, '17:00', '18:00', v_label)
      returning id into v_ev;
    if v_day <> 5 then
      insert into event_assignments (event_id, coach_id, source) values (v_ev, v_coach, 'manual');
    end if;
  end loop;
end $$;

select e.event_date, e.session_name, coalesce(string_agg(c.name, ', '), '(nobody)') as coaches
from events e
left join event_assignments a on a.event_id = e.id
left join coaches c on c.id = a.coach_id
where e.session_name like 'TEST -%'
group by e.id order by e.event_date;
