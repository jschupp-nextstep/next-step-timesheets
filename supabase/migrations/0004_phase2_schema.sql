-- Phase 2: entry_mode categorization, coach login identity, event
-- assignments, timesheet entries, and role-aware RLS (admin vs coach).

-- 1. programs.entry_mode -- drives which UI flow a program uses.
alter table programs add column entry_mode text not null default 'session'
  check (entry_mode in ('session', 'direct_time', 'direct_flat', 'admin_only', 'backend_only'));

update programs set entry_mode = 'direct_time' where name = 'Office Hours';
update programs set entry_mode = 'direct_flat' where name = '1v1 / Private Training';
update programs set entry_mode = 'admin_only' where name in ('Set-up/Break-down', 'Stipend');
update programs set entry_mode = 'backend_only' where name = 'Coaching';
-- Everything else (Annual Program, Town Session, Futsal, Pathway, Camp,
-- Nurse-Half Day, Nurse-Full Day) keeps the 'session' default.

-- 2. coaches.email -- links a coach's roster record to their login account.
-- Matched by email at login time, no manually-copied user ID required.
alter table coaches add column email text unique;

-- 3. event_assignments -- who's actually scheduled to work an event.
-- Populated by the Sprocket import for Camps; empty for program types
-- Sprocket doesn't track staff for (e.g. Annual Program).
create table event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  coach_id uuid not null references coaches (id),
  created_at timestamptz not null default now(),
  unique (event_id, coach_id)
);

-- 4. timesheet_entries -- what a coach actually submits.
create table timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches (id),
  program_id uuid not null references programs (id),
  event_id uuid references events (id),
  location_id uuid references locations (id),
  entry_date date not null,
  start_time time,
  end_time time,
  hours numeric(5, 2),
  session_name text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_date date,
  created_at timestamptz not null default now()
);

alter table event_assignments enable row level security;
alter table timesheet_entries enable row level security;

grant select, insert, update, delete on event_assignments, timesheet_entries to authenticated;

-- 5. Role model. auth.jwt() ->> 'email' reads the logged-in user's email
-- straight from their JWT -- no query against auth.users needed.
create or replace function current_coach_id() returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from coaches where email = auth.jwt() ->> 'email';
$$;

create or replace function is_admin() returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null and current_coach_id() is null;
$$;

-- 6. Rewrite RLS: Phase 1 treated "authenticated" as synonymous with
-- "admin," which stops being true now that coaches can log in too.
drop policy if exists "Authenticated users manage programs" on programs;
drop policy if exists "Authenticated users manage locations" on locations;
drop policy if exists "Authenticated users manage coaches" on coaches;
drop policy if exists "Authenticated users manage rates" on rates;
drop policy if exists "Authenticated users manage one_v_one_rates" on one_v_one_rates;
drop policy if exists "Authenticated users manage events" on events;

-- Reference data: any authenticated user (coach or admin) can read it, since
-- the coach-facing picker needs it; only admins can write it.
create policy "Anyone authenticated can read programs" on programs
  for select using (auth.role() = 'authenticated');
create policy "Admins insert programs" on programs
  for insert with check (is_admin());
create policy "Admins update programs" on programs
  for update using (is_admin()) with check (is_admin());
create policy "Admins delete programs" on programs
  for delete using (is_admin());

create policy "Anyone authenticated can read locations" on locations
  for select using (auth.role() = 'authenticated');
create policy "Admins insert locations" on locations
  for insert with check (is_admin());
create policy "Admins update locations" on locations
  for update using (is_admin()) with check (is_admin());
create policy "Admins delete locations" on locations
  for delete using (is_admin());

create policy "Anyone authenticated can read coaches" on coaches
  for select using (auth.role() = 'authenticated');
create policy "Admins insert coaches" on coaches
  for insert with check (is_admin());
create policy "Admins update coaches" on coaches
  for update using (is_admin()) with check (is_admin());
create policy "Admins delete coaches" on coaches
  for delete using (is_admin());

create policy "Anyone authenticated can read events" on events
  for select using (auth.role() = 'authenticated');
create policy "Admins insert events" on events
  for insert with check (is_admin());
create policy "Admins update events" on events
  for update using (is_admin()) with check (is_admin());
create policy "Admins delete events" on events
  for delete using (is_admin());

-- Pay rates and staff assignments: admin-only, no coach access at all.
create policy "Admins manage rates" on rates
  for all using (is_admin()) with check (is_admin());
create policy "Admins manage one_v_one_rates" on one_v_one_rates
  for all using (is_admin()) with check (is_admin());
create policy "Admins manage event_assignments" on event_assignments
  for all using (is_admin()) with check (is_admin());

-- timesheet_entries: a coach owns their own pending rows; admin can do
-- anything (including entering admin_only-program entries on a coach's
-- behalf, and managing paid entries).
create policy "Admins manage all timesheet_entries" on timesheet_entries
  for all using (is_admin()) with check (is_admin());
create policy "Coaches select own timesheet_entries" on timesheet_entries
  for select using (coach_id = current_coach_id());
create policy "Coaches insert own timesheet_entries" on timesheet_entries
  for insert with check (coach_id = current_coach_id());
create policy "Coaches update own pending timesheet_entries" on timesheet_entries
  for update using (coach_id = current_coach_id() and status = 'pending')
  with check (coach_id = current_coach_id() and status = 'pending');
create policy "Coaches delete own pending timesheet_entries" on timesheet_entries
  for delete using (coach_id = current_coach_id() and status = 'pending');
