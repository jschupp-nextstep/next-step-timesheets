-- Phase 9 step 1c: one app session = one or more Sprocket rows.
--
-- event_sprocket_rows: a row per Sprocket calendar row a session produces --
-- one per team (AP: Younger / Older / Jr. Academy; DSA / Town: one team) or a
-- single Club row (no team). Carries Sprocket's ClubCalendarEventID once
-- known, the raw row as Sprocket last sent it, and (for the export, later
-- steps) a hash of what we last uploaded and a state:
--   new            -- made here, not in Sprocket yet (no ID)
--   linked         -- in Sprocket, ID known
--   delete_pending -- to be sent as DeleteEvent (step 7)
--   deleted        -- deleted in Sprocket
--
-- Kept in step with events.sprocket_rows by a trigger, so both import paths
-- (new sessions, and sprocket_sync_event on re-import) maintain it without
-- importer changes. The same trigger fills the 0033 mapping tables and the
-- 0034 event fields (blanks only).
--
-- AP merge (Justin, 2026-11-22): the fall import made one session per AP
-- group per practice -- assigning a coach to "the AP session" would have
-- meant three Confirm hours and triple pay. Sessions of a combine_teams
-- program at the same date, start, end and location are merged into one
-- with all their rows; the name lists their titles ("Annual Program /
-- Junior Annual Program"), the same rule the updated importer uses, so a
-- re-import finds the merged session by any of its row IDs. Only sessions
-- with nothing attached (coaches, entries, claims, swaps, history) are
-- merged away; anything else is listed and left as it is.
--
-- MIGRATION <-> DEPLOY: run this together with the push of the matching
-- importer. The deployed importer would split a merged AP session apart again
-- on its next upload -- so no Sprocket import between running this and the
-- push landing.

create table event_sprocket_rows (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  -- null = a Club row (no team / program).
  sprocket_team_id text references sprocket_teams (sprocket_team_id),
  club_calendar_event_id text unique,
  sprocket_row jsonb,
  state text not null default 'new' check (state in ('new', 'linked', 'delete_pending', 'deleted')),
  last_uploaded_hash text,
  last_batch_id uuid,
  created_at timestamptz not null default now(),
  constraint event_sprocket_rows_id_when_linked check (state = 'new' or club_calendar_event_id is not null)
);
create index event_sprocket_rows_event_idx on event_sprocket_rows (event_id);

alter table event_sprocket_rows enable row level security;
revoke all on event_sprocket_rows from anon, authenticated;
grant select, insert, update, delete on event_sprocket_rows to authenticated;
create policy "Admins manage event_sprocket_rows" on event_sprocket_rows
  for all using (is_admin()) with check (is_admin());
create policy "Schedulers read in-scope event_sprocket_rows" on event_sprocket_rows
  for select using (is_scheduler_for_event(event_id));

-- After an event's raw Sprocket rows are written (import or re-import):
-- record its programs/teams/location/field IDs, fill its Sprocket fields if
-- still blank, and make event_sprocket_rows match the rows.
create or replace function events_sprocket_rows_sync() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  r jsonb;
  v_prog text;
  v_team text;
  v_loc text;
  v_field text;
  v_field_id uuid;
  v_id text;
  v_ids text[] := '{}';
  v_tbd boolean;
  v_first jsonb;
begin
  if jsonb_typeof(new.sprocket_rows) is distinct from 'array' then
    return null;
  end if;
  select name = 'Location TBD' into v_tbd from locations where id = new.location_id;

  for r in select value from jsonb_array_elements(new.sprocket_rows) loop
    v_prog := nullif(trim(r ->> 'ProgramID'), '');
    v_team := nullif(trim(r ->> 'TeamID'), '');
    v_loc := nullif(trim(r ->> 'LocationID'), '');
    v_field := nullif(trim(r ->> 'FieldID'), '');
    v_id := nullif(trim(r ->> 'ClubCalendarEventID'), '');

    if v_prog is not null then
      insert into sprocket_programs (sprocket_program_id, name, combine_teams)
      values (v_prog, coalesce(nullif(trim(r ->> 'ProgramName'), ''), v_prog),
              coalesce(r ->> 'ProgramName', '') ilike '%annual program%')
      on conflict (sprocket_program_id) do update set name = excluded.name;
    end if;
    if v_team is not null then
      insert into sprocket_teams (sprocket_team_id, name, sprocket_program_id, program_id)
      values (v_team, coalesce(nullif(trim(r ->> 'TeamName'), ''), v_team), v_prog, new.program_id)
      on conflict (sprocket_team_id) do update
        set name = excluded.name,
            sprocket_program_id = coalesce(excluded.sprocket_program_id, sprocket_teams.sprocket_program_id);
    end if;
    if v_loc is not null and not coalesce(v_tbd, false) then
      update locations set sprocket_location_id = v_loc
      where id = new.location_id and sprocket_location_id is null;
    end if;
    if v_field is not null and not coalesce(v_tbd, false) then
      insert into fields (location_id, name, sprocket_field_id)
      values (new.location_id, coalesce(nullif(trim(r ->> 'FieldName'), ''), v_field), v_field)
      on conflict (sprocket_field_id) do update set name = excluded.name
      returning id into v_field_id;
    end if;
    if v_id is not null then
      insert into event_sprocket_rows (event_id, sprocket_team_id, club_calendar_event_id, sprocket_row, state)
      values (new.id, v_team, v_id, r, 'linked')
      on conflict (club_calendar_event_id) do update
        set event_id = excluded.event_id,
            sprocket_team_id = excluded.sprocket_team_id,
            sprocket_row = excluded.sprocket_row,
            state = case when event_sprocket_rows.state = 'new' then 'linked' else event_sprocket_rows.state end;
      v_ids := v_ids || v_id;
    end if;
  end loop;

  -- Rows Sprocket no longer sends for this session (e.g. a Camp staff row
  -- dropped). Rows made here (state new, no ID) are never touched.
  delete from event_sprocket_rows
  where event_id = new.id and state = 'linked' and not (club_calendar_event_id = any (v_ids));

  -- Blanks only: a value set here is never overwritten by an import.
  v_first := new.sprocket_rows -> 0;
  update events set
    event_type = case lower(trim(v_first ->> 'ClubEventType'))
      when 'practice' then 'practice' when 'game' then 'game' when 'club' then 'club' when 'other' then 'other' end,
    opponent = nullif(trim(v_first ->> 'Opponent'), ''),
    away_game = lower(trim(coalesce(v_first ->> 'AwayGame', ''))) = 'yes',
    uniform = nullif(trim(v_first ->> 'Uniform'), ''),
    is_private = lower(trim(coalesce(v_first ->> 'IsPrivate', ''))) = 'yes',
    arrival_minutes = sprocket_arrival_minutes(v_first ->> 'ArrivalTime', new.start_time)
  where id = new.id and event_type is null;
  if v_field_id is not null then
    update events set field_id = v_field_id where id = new.id and field_id is null;
  end if;
  return null;
end;
$$;

revoke execute on function events_sprocket_rows_sync() from public, anon, authenticated;

create trigger events_sprocket_rows_sync
  after insert or update of sprocket_rows on events
  for each row execute function events_sprocket_rows_sync();

-- AP merge, then backfill every imported session's rows through the trigger.
drop table if exists ap_merge_report;
create temp table ap_merge_report (session text, outcome text);

do $$
declare
  g record;
  v_keep uuid;
  v_others uuid[];
  v_busy uuid[];
  v_rows jsonb;
  v_ids text[];
  v_name text;
  v_label text;
begin
  for g in
    select e.event_date, e.start_time, e.end_time, e.location_id, e.program_id,
      array_agg(e.id order by e.created_at, e.id) as ids,
      count(distinct e.is_cancelled) as cancel_states
    from events e
    where jsonb_typeof(e.sprocket_rows) = 'array'
      and exists (select 1 from sprocket_programs sp
                  where sp.combine_teams and sp.sprocket_program_id = e.sprocket_rows -> 0 ->> 'ProgramID')
    group by e.event_date, e.start_time, e.end_time, e.location_id, e.program_id
  loop
    v_label := to_char(g.event_date, 'FMMM/FMDD') || ' ' || to_char(g.start_time, 'FMHH12:MI AM')
      || ' at ' || (select name from locations where id = g.location_id);

    -- Sessions with anything attached.
    select coalesce(array_agg(u.eid), '{}') into v_busy from unnest(g.ids) as u(eid)
    where exists (select 1 from event_assignments a where a.event_id = u.eid)
       or exists (select 1 from timesheet_entries t where t.event_id = u.eid)
       or exists (select 1 from payment_claims c where c.event_id = u.eid)
       or exists (select 1 from swap_requests s where s.event_id = u.eid)
       or exists (select 1 from schedule_changes h where h.event_id = u.eid);

    if cardinality(g.ids) > 1 and (cardinality(v_busy) > 1 or g.cancel_states > 1) then
      insert into ap_merge_report values (v_label,
        case when g.cancel_states > 1 then 'NOT merged: some of its groups are cancelled and some aren''t'
             else 'NOT merged: ' || cardinality(v_busy) || ' of its ' || cardinality(g.ids)
                  || ' sessions have coaches, entries, claims or history -- merge by hand' end);
      continue;
    end if;

    v_keep := coalesce(v_busy[1], g.ids[1]);
    v_others := array(select u.eid from unnest(g.ids) as u(eid) where u.eid <> v_keep);

    select jsonb_agg(r order by r ->> 'TeamName'),
           array_agg(distinct r ->> 'ClubCalendarEventID') filter (where nullif(trim(r ->> 'ClubCalendarEventID'), '') is not null)
      into v_rows, v_ids
    from events e, jsonb_array_elements(e.sprocket_rows) r
    where e.id = any (g.ids);
    -- Same rule as the importer's combinedTitle(): distinct, byte order.
    select string_agg(t, ' / ' order by t collate "C") into v_name
    from (select distinct nullif(trim(r ->> 'Title'), '') as t
          from events e, jsonb_array_elements(e.sprocket_rows) r where e.id = any (g.ids)) x
    where t is not null;

    delete from events where id = any (v_others);
    update events set
      sprocket_rows = v_rows,
      sprocket_event_ids = coalesce(v_ids, sprocket_event_ids),
      session_name = coalesce(v_name, session_name),
      sprocket_snapshot = case when sprocket_snapshot is null then null
        else jsonb_set(sprocket_snapshot, '{session_name}', to_jsonb(coalesce(v_name, session_name))) end
    where id = v_keep;

    insert into ap_merge_report values (v_label,
      case when cardinality(g.ids) > 1 then 'merged ' || cardinality(g.ids) || ' into one: ' || coalesce(v_name, '')
           else 'renamed: ' || coalesce(v_name, '') end);
  end loop;
end $$;

-- Backfill: fire the trigger for every other imported session.
update events set sprocket_rows = sprocket_rows
where jsonb_typeof(sprocket_rows) = 'array'
  and not exists (select 1 from event_sprocket_rows x where x.event_id = events.id);

select outcome, count(*) from ap_merge_report
group by outcome order by count(*) desc;
