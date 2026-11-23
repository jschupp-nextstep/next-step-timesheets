-- Fix: the 0035 sync trigger overwrote a Sprocket program's, team's or
-- field's stored name with its bare ID whenever a row arrived without the
-- name (Sprocket's own exports always carry it, but test rows during the
-- Phase 9 checks didn't, and three AP team names became "73441" etc.).
-- Now a row without a name keeps the stored one. Then names that equal
-- their ID are restored from any stored raw row that has the name.
--
-- Same signature; safe with the deployed code.

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
      on conflict (sprocket_program_id) do update
        set name = case when nullif(trim(r ->> 'ProgramName'), '') is not null then excluded.name else sprocket_programs.name end;
    end if;
    if v_team is not null then
      insert into sprocket_teams (sprocket_team_id, name, sprocket_program_id, program_id)
      values (v_team, coalesce(nullif(trim(r ->> 'TeamName'), ''), v_team), v_prog, new.program_id)
      on conflict (sprocket_team_id) do update
        set name = case when nullif(trim(r ->> 'TeamName'), '') is not null then excluded.name else sprocket_teams.name end,
            sprocket_program_id = coalesce(excluded.sprocket_program_id, sprocket_teams.sprocket_program_id);
    end if;
    if v_loc is not null and not coalesce(v_tbd, false) then
      update locations set sprocket_location_id = v_loc
      where id = new.location_id and sprocket_location_id is null;
    end if;
    if v_field is not null and not coalesce(v_tbd, false) then
      insert into fields (location_id, name, sprocket_field_id)
      values (new.location_id, coalesce(nullif(trim(r ->> 'FieldName'), ''), v_field), v_field)
      on conflict (sprocket_field_id) do update
        set name = case when nullif(trim(r ->> 'FieldName'), '') is not null then excluded.name else fields.name end
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

-- Repair from the raw rows still on file.
update sprocket_teams t set name = s.name
from (
  select distinct on (x.sprocket_row ->> 'TeamID') x.sprocket_row ->> 'TeamID' as id, trim(x.sprocket_row ->> 'TeamName') as name
  from event_sprocket_rows x
  where nullif(trim(x.sprocket_row ->> 'TeamName'), '') is not null
  order by x.sprocket_row ->> 'TeamID', x.created_at desc
) s
where t.sprocket_team_id = s.id and t.name = t.sprocket_team_id;

update sprocket_programs p set name = s.name
from (
  select distinct on (x.sprocket_row ->> 'ProgramID') x.sprocket_row ->> 'ProgramID' as id, trim(x.sprocket_row ->> 'ProgramName') as name
  from event_sprocket_rows x
  where nullif(trim(x.sprocket_row ->> 'ProgramName'), '') is not null
  order by x.sprocket_row ->> 'ProgramID', x.created_at desc
) s
where p.sprocket_program_id = s.id and p.name = p.sprocket_program_id;

update fields f set name = s.name
from (
  select distinct on (x.sprocket_row ->> 'FieldID') x.sprocket_row ->> 'FieldID' as id, trim(x.sprocket_row ->> 'FieldName') as name
  from event_sprocket_rows x
  where nullif(trim(x.sprocket_row ->> 'FieldName'), '') is not null
  order by x.sprocket_row ->> 'FieldID', x.created_at desc
) s
where f.sprocket_field_id = s.id and f.name = f.sprocket_field_id;

-- Anything still named by its ID (should be none):
select 'team' as kind, sprocket_team_id as id from sprocket_teams where name = sprocket_team_id
union all select 'program', sprocket_program_id from sprocket_programs where name = sprocket_program_id
union all select 'field', sprocket_field_id from fields where name = sprocket_field_id;
