-- Phase 9 step 1a: Sprocket's own IDs for programs, teams, locations and
-- fields, so the app can later write rows Sprocket will import (export) and
-- recognise its rows (link IDs). Until now these lived only inside each
-- imported event's raw rows (0030) and the importer's per-browser
-- localStorage.
--
--   sprocket_programs -- one per Sprocket program (a season: "DSSC
--                        2026-2027"). combine_teams: its teams share one
--                        session per time slot (Annual Program -- Justin,
--                        2026-11-22), see 0035.
--   sprocket_teams    -- one per Sprocket team; program_id = the app program
--                        its sessions belong to; is_default = included when a
--                        new session for that app program is created.
--   locations.sprocket_location_id, fields (+ events.field_id).
--
-- Filled from the raw rows of every imported event (below), and kept up to
-- date on every later import by 0035's trigger. Editable on the Sprocket
-- mappings screen.
--
-- Additive only: the deployed code reads none of it.

create table sprocket_programs (
  sprocket_program_id text primary key,
  name text not null,
  combine_teams boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table sprocket_teams (
  sprocket_team_id text primary key,
  name text not null,
  sprocket_program_id text references sprocket_programs (sprocket_program_id),
  program_id uuid references programs (id),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Not unique: several dated Camp locations here are one Sprocket location.
alter table locations add column if not exists sprocket_location_id text;

create table fields (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations (id),
  name text not null,
  sprocket_field_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table events add column if not exists field_id uuid references fields (id);

alter table sprocket_programs enable row level security;
alter table sprocket_teams enable row level security;
alter table fields enable row level security;
revoke all on sprocket_programs, sprocket_teams, fields from anon, authenticated;
grant select, insert, update, delete on sprocket_programs, sprocket_teams, fields to authenticated;

-- Read by anyone with a role (schedulers pick teams/fields when creating
-- sessions); written by admins only.
create policy "App users read sprocket_programs" on sprocket_programs for select using (has_app_role());
create policy "Admins manage sprocket_programs" on sprocket_programs for all using (is_admin()) with check (is_admin());
create policy "App users read sprocket_teams" on sprocket_teams for select using (has_app_role());
create policy "Admins manage sprocket_teams" on sprocket_teams for all using (is_admin()) with check (is_admin());
create policy "App users read fields" on fields for select using (has_app_role());
create policy "Admins manage fields" on fields for all using (is_admin()) with check (is_admin());

-- Seed from what's already been imported. (0035's trigger does the same for
-- each event from now on, and re-runs it for every existing event -- this
-- just makes the tables readable on their own if 0035 isn't run yet.)
insert into sprocket_programs (sprocket_program_id, name)
select distinct on (r ->> 'ProgramID') r ->> 'ProgramID', coalesce(nullif(trim(r ->> 'ProgramName'), ''), r ->> 'ProgramID')
from events e, jsonb_array_elements(e.sprocket_rows) r
where nullif(trim(r ->> 'ProgramID'), '') is not null
order by r ->> 'ProgramID', e.event_date desc
on conflict do nothing;

-- Justin, 2026-11-22: an AP practice is one session for all its groups.
update sprocket_programs set combine_teams = true where name ilike '%annual program%';

insert into sprocket_teams (sprocket_team_id, name, sprocket_program_id, program_id)
select distinct on (r ->> 'TeamID') r ->> 'TeamID', coalesce(nullif(trim(r ->> 'TeamName'), ''), r ->> 'TeamID'),
  nullif(trim(r ->> 'ProgramID'), ''), e.program_id
from events e, jsonb_array_elements(e.sprocket_rows) r
where nullif(trim(r ->> 'TeamID'), '') is not null
order by r ->> 'TeamID', e.event_date desc
on conflict do nothing;

-- New AP sessions get the three groups (not Goalkeepers, which only joins
-- the video sessions).
update sprocket_teams set is_default = true
where name in ('Annual Program- Younger AP Players', 'Annual Program- Older AP Players', 'Annual Program- Jr. Academy');

-- Each location's Sprocket ID: the one its imported events used most.
update locations l set sprocket_location_id = x.sid
from (
  select distinct on (e.location_id) e.location_id, r ->> 'LocationID' as sid
  from events e, jsonb_array_elements(e.sprocket_rows) r
  where nullif(trim(r ->> 'LocationID'), '') is not null
  group by e.location_id, r ->> 'LocationID'
  order by e.location_id, count(*) desc
) x
where l.id = x.location_id and l.sprocket_location_id is null and l.name <> 'Location TBD';

insert into fields (location_id, name, sprocket_field_id)
select distinct on (r ->> 'FieldID') e.location_id, coalesce(nullif(trim(r ->> 'FieldName'), ''), r ->> 'FieldID'), r ->> 'FieldID'
from events e join locations l on l.id = e.location_id, jsonb_array_elements(e.sprocket_rows) r
where nullif(trim(r ->> 'FieldID'), '') is not null and l.name <> 'Location TBD'
order by r ->> 'FieldID', e.event_date desc
on conflict do nothing;

update events e set field_id = f.id
from fields f
where e.field_id is null and e.sprocket_rows is not null
  and f.sprocket_field_id = nullif(trim(e.sprocket_rows -> 0 ->> 'FieldID'), '');

select
  (select count(*) from sprocket_programs) as programs,
  (select count(*) from sprocket_programs where combine_teams) as combined_programs,
  (select count(*) from sprocket_teams) as teams,
  (select count(*) from sprocket_teams where is_default) as default_teams,
  (select count(*) from locations where sprocket_location_id is not null) as locations_with_id,
  (select count(*) from fields) as fields,
  (select count(*) from events where field_id is not null) as events_with_field;
