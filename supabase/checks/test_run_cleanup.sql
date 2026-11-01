-- Removes everything test_run_setup.sql made, plus whatever the test run
-- created on those sessions (entries, claims, swaps, history). TEST COACH is
-- switched off again (kept as the standing test login).
do $$
declare
  v_coach uuid := (select id from coaches where name = 'TEST COACH');
  v_events uuid[] := array(select id from events where session_name like 'TEST -%'
                           or location_id = (select id from locations where name = 'TEST LOCATION'));
begin
  delete from entry_messages where entry_id in (
    select id from timesheet_entries where coach_id = v_coach or event_id = any(v_events));
  delete from payment_claims where coach_id = v_coach or event_id = any(v_events);
  delete from swap_requests where coach_id = v_coach or event_id = any(v_events);
  delete from timesheet_entries where coach_id = v_coach or event_id = any(v_events);
  delete from events where id = any(v_events);           -- assignments + history cascade
  delete from rates where coach_id = v_coach;
  delete from schedulers where email = 'schupp.14+scheduler@gmail.com';  -- scopes cascade
  delete from locations where name = 'TEST LOCATION';
  update coaches set is_active = false where id = v_coach;
end $$;

-- Check: every count should be 0.
select
  (select count(*) from events where session_name like 'TEST -%') as test_sessions,
  (select count(*) from timesheet_entries t join coaches c on c.id = t.coach_id where c.name = 'TEST COACH') as test_coach_entries,
  (select count(*) from rates r join coaches c on c.id = r.coach_id where c.name = 'TEST COACH') as test_coach_rates,
  (select count(*) from schedulers where email = 'schupp.14+scheduler@gmail.com') as test_scheduler,
  (select count(*) from locations where name = 'TEST LOCATION') as test_location;
