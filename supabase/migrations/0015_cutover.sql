-- Cutover from the old Sheets system, plus the "paid through" marker that
-- drives Payment Due's default date range.
--
-- Sessions dated before cutover_date were paid in Sheets and aren't marked
-- paid here, so nothing before it may be logged, claimed, or paid in the
-- app unless an admin entered it. Enforced in RLS (coach policies below),
-- not just in the date pickers -- the band logic in src/utils/payPeriods.ts
-- is client-side only and a raw REST call skips it entirely.

-- 1. Single-row settings table. Kept separate from pay_periods on purpose:
-- band math counts pay periods by row position, so tying cutover to "the
-- first pay_periods row" would silently move it if an earlier period were
-- ever added.
create table app_settings (
  id int primary key default 1 check (id = 1),
  cutover_date date,
  -- Payment Due's default range starts the day after this. Advanced by the
  -- app when a payroll range has been fully marked paid; hand-editable on
  -- /settings.
  paid_through_date date,
  updated_at timestamptz not null default now()
);

insert into app_settings (id, cutover_date, paid_through_date)
values (1, '2026-10-07', '2026-10-06');

alter table app_settings enable row level security;
grant select, update on app_settings to authenticated;

create policy "Anyone authenticated can read app_settings" on app_settings
  for select using (auth.role() = 'authenticated');
create policy "Admins update app_settings" on app_settings
  for update using (is_admin()) with check (is_admin());

create or replace function cutover_date() returns date
language sql stable security definer
set search_path = public
as $$
  select cutover_date from app_settings where id = 1;
$$;

-- A coach may only touch dates from cutover through today. "Today" is
-- Eastern time explicitly -- current_date is UTC, which runs a day ahead
-- every evening. This also closes logging sessions in advance, which the
-- UI already blocks but RLS never did.
create or replace function coach_date_allowed(d date) returns boolean
language sql stable security definer
set search_path = public
as $$
  select d is not null
    and d >= coalesce(cutover_date(), '-infinity'::date)
    and d <= (now() at time zone 'America/New_York')::date;
$$;

-- 2. timesheet_entries.admin_entered -- the "unless Justin enters it"
-- exception. Set by trigger, never trusted from the client: on insert it's
-- whether the inserting user is an admin; on update only an admin can
-- change it (e.g. the Payment Due cleanup card's "Pay in app" action).
-- Existing rows backfill to false, so any pre-cutover pending entry --
-- including ones an admin created before this column existed -- shows up
-- in Payment Due's one-time cleanup card for a decision.
alter table timesheet_entries add column admin_entered boolean not null default false;

create or replace function set_timesheet_entry_admin_entered() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.admin_entered := is_admin();
  elsif not is_admin() then
    new.admin_entered := old.admin_entered;
  end if;
  return new;
end;
$$;

create trigger timesheet_entries_set_admin_entered
  before insert or update on timesheet_entries
  for each row execute function set_timesheet_entry_admin_entered();

-- 3. Coach timesheet_entries policies, rewritten with the date window.
-- Delete is left alone: a coach deleting their own stale pre-cutover
-- pending entry can't cause a payment.
drop policy "Coaches insert own timesheet_entries" on timesheet_entries;
drop policy "Coaches update own pending timesheet_entries" on timesheet_entries;

create policy "Coaches insert own timesheet_entries" on timesheet_entries
  for insert with check (coach_id = current_coach_id() and coach_date_allowed(entry_date));
create policy "Coaches update own pending timesheet_entries" on timesheet_entries
  for update using (coach_id = current_coach_id() and status = 'pending' and coach_date_allowed(entry_date))
  with check (coach_id = current_coach_id() and status = 'pending' and coach_date_allowed(entry_date));

-- 4. payment_claims: same window, using approx_date for unstructured
-- claims and the linked event's date for everything else.
create or replace function claim_date(p_event_id uuid, p_approx_date date) returns date
language sql stable security definer
set search_path = public
as $$
  select coalesce(p_approx_date, (select event_date from events where id = p_event_id));
$$;

drop policy "Coaches insert own payment_claims" on payment_claims;

create policy "Coaches insert own payment_claims" on payment_claims
  for insert with check (
    coach_id = current_coach_id() and coach_date_allowed(claim_date(event_id, approx_date))
  );

-- log-session.tsx resubmits a still-pending hours_correction by UPDATING
-- it in place, but 0014 never gave coaches an update policy -- so that
-- update matched zero rows and silently did nothing. Coaches may edit only
-- their own still-pending claims, and can't use it to decide one.
drop policy if exists "Coaches update own pending payment_claims" on payment_claims;
create policy "Coaches update own pending payment_claims" on payment_claims
  for update using (coach_id = current_coach_id() and status = 'pending')
  with check (
    coach_id = current_coach_id() and status = 'pending'
    and coach_date_allowed(claim_date(event_id, approx_date))
  );
