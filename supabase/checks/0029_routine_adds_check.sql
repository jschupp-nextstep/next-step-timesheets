-- Self-check for 0029. Runs as a pretend scheduler (Annual Program rule) and
-- ALWAYS ends with an error on purpose, so nothing it creates is kept. Read the
-- result in the error message.
-- Expected: future/1 routine reviewed, future/2 routine reviewed,
--           staffed needs_review, today needs_review.
do $$
declare
  v_ap uuid := (select id from programs where name = 'Annual Program');
  v_loc uuid := (select id from locations order by name limit 1);
  v_today date := (now() at time zone 'America/New_York')::date;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_future uuid; v_staffed uuid; v_now uuid;
  v_sched uuid;
  v_result text;
begin
  select id into v_c1 from coaches where is_active order by name limit 1;
  select id into v_c2 from coaches where is_active order by name offset 1 limit 1;
  select id into v_c3 from coaches where is_active order by name offset 2 limit 1;

  insert into schedulers (name, email) values ('R9 CHECK', 'r9check@example.com') returning id into v_sched;
  insert into scheduler_scopes (scheduler_id, program_id) values (v_sched, v_ap);
  insert into events (program_id, location_id, event_date, start_time, end_time, session_name)
    values (v_ap, v_loc, v_today + 7, '17:30', '18:30', 'R9 CHECK future') returning id into v_future;
  insert into events (program_id, location_id, event_date, start_time, end_time, session_name)
    values (v_ap, v_loc, v_today + 7, '18:30', '19:30', 'R9 CHECK staffed') returning id into v_staffed;
  insert into events (program_id, location_id, event_date, start_time, end_time, session_name)
    values (v_ap, v_loc, v_today, '17:30', '18:30', 'R9 CHECK today') returning id into v_now;
  insert into event_assignments (event_id, coach_id, source) values (v_staffed, v_c1, 'manual');

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000029","email":"r9check@example.com","role":"authenticated"}', true);
  execute 'set local role authenticated';
  perform schedule_add(v_future, v_c1, 'Weekly roster');
  perform schedule_add(v_future, v_c2, 'Weekly roster');
  perform schedule_add(v_staffed, v_c3, 'Weekly roster');
  perform schedule_add(v_now, v_c1, 'Weekly roster');
  execute 'reset role';

  select string_agg(format('%s: routine=%s %s', e.session_name, c.routine, c.review_status), ' | ' order by e.session_name, c.changed_at)
    into v_result
    from schedule_changes c join events e on e.id = c.event_id
    where e.session_name like 'R9 CHECK%';
  raise exception 'RESULT (all rolled back): %', v_result;
end $$;
