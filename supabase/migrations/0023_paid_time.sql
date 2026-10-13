-- R3: paid-time rules, plus inactive-coach write lockout (Justin, 2026-10-13).
--
-- Additive only. Run it BEFORE pushing the matching code: the new importers
-- write events.paid_early_minutes, which must exist first. The currently
-- deployed code never reads or writes these columns, so running this early
-- changes nothing for it (see "Migration ↔ deploy rule" in CLAUDE.md).

-- 1. Paid-time rules. Paid start = scheduled start minus N minutes; paid end
-- = scheduled end. Stored as minutes-before-start (not a clock time) so a
-- schedule time change carries the paid window with it. Resolution, in
-- src/utils/hours.ts: event override, else program rule, else 0; ignored
-- for Camp/Nurse fixed-hours programs.
alter table programs
  add column paid_early_minutes int not null default 0 check (paid_early_minutes between 0 and 180);
alter table events
  add column paid_early_minutes int check (paid_early_minutes between 0 and 180);

-- AP is paid from 15 minutes before the start: every program with "Annual
-- Program" in its name (Justin, 2026-10-13). Games get theirs per event, from
-- Sprocket's ArrivalTime on Game rows or set by hand.
update programs set paid_early_minutes = 15 where name ilike '%annual program%';

-- 2. Inactive coaches can still sign in and read their history, but can't
-- create or change entries, claims, or swap requests.
create or replace function coach_is_active() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select is_active from coaches where id = current_coach_id()), false);
$$;

revoke execute on function coach_is_active() from public, anon;
grant execute on function coach_is_active() to authenticated;

drop policy "Coaches insert own timesheet_entries" on timesheet_entries;
create policy "Coaches insert own timesheet_entries" on timesheet_entries
  for insert with check (coach_id = current_coach_id() and coach_is_active() and coach_date_allowed(entry_date));

drop policy "Coaches update own pending timesheet_entries" on timesheet_entries;
create policy "Coaches update own pending timesheet_entries" on timesheet_entries
  for update using (coach_id = current_coach_id() and coach_is_active() and status = 'pending' and coach_date_allowed(entry_date))
  with check (coach_id = current_coach_id() and coach_is_active() and status = 'pending' and coach_date_allowed(entry_date));

drop policy "Coaches insert own payment_claims" on payment_claims;
create policy "Coaches insert own payment_claims" on payment_claims
  for insert with check (
    coach_id = current_coach_id() and coach_is_active() and coach_date_allowed(claim_date(event_id, approx_date))
  );

drop policy "Coaches update own pending payment_claims" on payment_claims;
create policy "Coaches update own pending payment_claims" on payment_claims
  for update using (coach_id = current_coach_id() and coach_is_active() and status = 'pending')
  with check (
    coach_id = current_coach_id() and coach_is_active() and status = 'pending'
    and coach_date_allowed(claim_date(event_id, approx_date))
  );

drop policy "Coaches insert own swap_requests" on swap_requests;
create policy "Coaches insert own swap_requests" on swap_requests
  for insert with check (coach_id = current_coach_id() and coach_is_active());
