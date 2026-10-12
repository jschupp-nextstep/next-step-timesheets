-- R2a: explicit roles. Admin becomes an allowlist, and a new scheduler role
-- (Nick, Luis) can see the schedule for the events they manage. Scheduler
-- WRITE paths (sub/add/remove/time/cancel/create) come in R2b as logged
-- security-definer functions -- this migration gives schedulers no write
-- access to anything.

-- 1. Admin allowlist. Until now is_admin() was "signed in and not on the
-- coach roster" -- so any login that wasn't a coach (including a stranger's
-- magic-link sign-up, or a scheduler) got full admin, rates and payroll
-- included. Now it's membership in this table, nothing else.
create table admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  created_at timestamptz not null default now()
);

insert into admins (email) values ('jschupp@next-step-training.com');

create or replace function is_admin() returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from admins where email = lower(auth.jwt() ->> 'email'));
$$;

alter table admins enable row level security;
grant select, insert, update, delete on admins to authenticated;
-- Admin-managed. Adding the first admin, or recovering from removing the
-- last one, is done in the SQL Editor, which bypasses RLS.
create policy "Admins manage admins" on admins
  for all using (is_admin()) with check (is_admin());

-- 2. Schedulers, matched to a login by email the same way coaches are. A
-- person can be both a coach and a scheduler (same email in both tables).
create table schedulers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique check (email = lower(email)),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Two kinds of scope rule, decided with Justin:
--   * program and/or location: manages events matching both non-null fields
--     (e.g. Town Sessions at Natick; or all Annual Program).
--   * coach: manages any event that coach is assigned to, even outside the
--     scheduler's programs/locations.
-- Creating events (R2b) requires a program/location rule -- a brand-new
-- event has no coaches yet for a coach rule to match.
create table scheduler_scopes (
  id uuid primary key default gen_random_uuid(),
  scheduler_id uuid not null references schedulers (id) on delete cascade,
  program_id uuid references programs (id),
  location_id uuid references locations (id),
  coach_id uuid references coaches (id),
  created_at timestamptz not null default now(),
  constraint scheduler_scopes_one_kind check (
    (coach_id is null and (program_id is not null or location_id is not null))
    or (coach_id is not null and program_id is null and location_id is null)
  )
);

create index scheduler_scopes_scheduler_idx on scheduler_scopes (scheduler_id);

create or replace function current_scheduler_id() returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from schedulers where email = lower(auth.jwt() ->> 'email') and is_active;
$$;

-- Evaluated BEFORE any R2b change is applied, so a scheduler can sub out
-- one of their coach-rule coaches even though the event then drops out of
-- that rule's scope.
create or replace function is_scheduler_for_event(p_event_id uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from events e
    join scheduler_scopes s on s.scheduler_id = current_scheduler_id()
    where e.id = p_event_id
      and (
        (s.coach_id is null
          and (s.program_id is null or s.program_id = e.program_id)
          and (s.location_id is null or s.location_id = e.location_id))
        or (s.coach_id is not null
          and exists (select 1 from event_assignments a where a.event_id = e.id and a.coach_id = s.coach_id))
      )
  );
$$;

create or replace function is_scheduler_for_program_location(p_program_id uuid, p_location_id uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from scheduler_scopes s
    where s.scheduler_id = current_scheduler_id()
      and s.coach_id is null
      and (s.program_id is null or s.program_id = p_program_id)
      and (s.location_id is null or s.location_id = p_location_id)
  );
$$;

-- Computed column: lets the scheduler UI filter events with
-- `.eq('in_my_scope', true)` instead of re-implementing the rules above
-- client-side.
create or replace function in_my_scope(e events) returns boolean
language sql stable
set search_path = public
as $$
  select is_scheduler_for_event(e.id);
$$;

alter table schedulers enable row level security;
alter table scheduler_scopes enable row level security;
grant select, insert, update, delete on schedulers, scheduler_scopes to authenticated;

create policy "Admins manage schedulers" on schedulers
  for all using (is_admin()) with check (is_admin());
create policy "Schedulers read own scheduler row" on schedulers
  for select using (id = current_scheduler_id());
create policy "Admins manage scheduler_scopes" on scheduler_scopes
  for all using (is_admin()) with check (is_admin());
create policy "Schedulers read own scheduler_scopes" on scheduler_scopes
  for select using (scheduler_id = current_scheduler_id());

-- 3. Schedulers can see who's assigned to the events they manage -- read
-- only. events/programs/locations/coaches are already readable by anyone
-- signed in; rates, timesheet_entries, payment_claims, swap_requests and
-- app_settings writes all stay admin/coach-only, untouched here.
create policy "Schedulers select in-scope event_assignments" on event_assignments
  for select using (is_scheduler_for_event(event_id));
