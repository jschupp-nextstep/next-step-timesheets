-- Phase 9 step 8: compare mode (Justin, 2026-11-24).
--
-- Once the app keeps the schedule (app_managed sessions, and every session
-- dated on/after app_settings.schedule_source_from), Import Calendar no
-- longer applies Sprocket's changes to those sessions on its own. It lists
-- each one that differs from what the app last sent or saw, and an admin picks:
--
--   sprocket_take_event(event, snapshot, rows, ids) -- take Sprocket's
--     version: date/times, cancelled, location, name, coaches (only when every
--     coach Sprocket names is mapped), private/opponent/away/arrival/field.
--     Each schedule change is logged as an admin change, reason "Taken from
--     Sprocket". Then the stored Sprocket rows become Sprocket's, so the next
--     export has nothing to send back.
--
--   sprocket_keep_app(event, rows, sprocket_coach_ids) -- keep the app's: only
--     record what Sprocket has now, so Export to Sprocket (New and changed)
--     lists the session and sends the app's version back over it.
--
-- Additive (two new functions).

create or replace function sprocket_take_event(
  p_event_id uuid,
  p_snapshot jsonb,   -- as sprocket_sync_event, plus coaches_complete boolean
  p_rows jsonb,       -- ALL of the session's Sprocket rows (stored ones with the file's replacing by ID)
  p_ids text[]
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_reason constant text := 'Taken from Sprocket';
  v_batch uuid := gen_random_uuid();
  e events%rowtype;
  v_first jsonb := p_rows -> 0;
  v_date date := (p_snapshot ->> 'event_date')::date;
  v_start time := (p_snapshot ->> 'start_time')::time;
  v_end time := (p_snapshot ->> 'end_time')::time;
  v_cancelled boolean := (p_snapshot ->> 'is_cancelled')::boolean;
  v_loc uuid := (p_snapshot ->> 'location_id')::uuid;
  v_name text := nullif(trim(p_snapshot ->> 'session_name'), '');
  v_new_coaches uuid[] := coalesce(array(select jsonb_array_elements_text(p_snapshot -> 'coach_ids'))::uuid[], '{}');
  v_coach uuid;
  v_changes text[] := '{}';
  v_parts text[] := '{}';
  v_field uuid;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can take changes from Sprocket.' using errcode = '42501';
  end if;
  select * into e from events where id = p_event_id for update;
  if not found then
    raise exception 'That session no longer exists.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No Sprocket rows given.' using errcode = '22023';
  end if;

  -- Date + times.
  if v_date is not null and (e.event_date <> v_date or e.start_time is distinct from v_start or e.end_time is distinct from v_end) then
    perform set_config('app.schedule_change_logged', 'on', true);
    update events set event_date = v_date, start_time = v_start, end_time = v_end where id = e.id;
    perform set_config('app.schedule_change_logged', 'off', true);
    perform schedule_log(v_batch, 'time', e.id, 'admin',
      v_reason || case when e.event_date <> v_date
        then ' (moved from ' || to_char(e.event_date, 'FMMM/FMDD') || ' to ' || to_char(v_date, 'FMMM/FMDD') || ')' else '' end,
      null, null, e.start_time, e.end_time, v_start, v_end);
    v_changes := v_changes || 'date/time'::text;
  end if;

  -- Cancelled / restored.
  if v_cancelled is not null and e.is_cancelled <> v_cancelled then
    perform set_config('app.schedule_change_logged', 'on', true);
    update events set is_cancelled = v_cancelled,
      cancellation_timing = case when v_cancelled then cancellation_timing else null end
      where id = e.id;
    perform set_config('app.schedule_change_logged', 'off', true);
    perform schedule_log(v_batch, case when v_cancelled then 'cancel' else 'restore' end, e.id, 'admin', v_reason);
    v_changes := v_changes || (case when v_cancelled then 'cancelled' else 'restored' end);
  end if;

  -- Location (only to a real, mapped location) and name (one-row, non-game sessions).
  if v_loc is not null and v_loc <> e.location_id
     and not exists (select 1 from locations where id = v_loc and name = 'Location TBD') then
    v_parts := v_parts || ('location ' || coalesce((select name from locations where id = e.location_id), '?')
      || ' → ' || coalesce((select name from locations where id = v_loc), '?'));
    update events set location_id = v_loc where id = e.id;
  end if;
  if v_name is not null and v_name is distinct from e.session_name
     and jsonb_array_length(p_rows) = 1 and coalesce(e.event_type, 'practice') <> 'game' then
    v_parts := v_parts || ('name "' || coalesce(e.session_name, '') || '" → "' || v_name || '"');
    update events set session_name = v_name where id = e.id;
  end if;
  if array_length(v_parts, 1) > 0 then
    perform schedule_log(v_batch, 'details', e.id, 'admin', v_reason || ': ' || array_to_string(v_parts, '; '));
    v_changes := v_changes || v_parts;
  end if;

  -- Coaches: only when every coach Sprocket names was mapped.
  if coalesce((p_snapshot ->> 'coaches_complete')::boolean, false) then
    foreach v_coach in array v_new_coaches loop
      if exists (select 1 from event_assignments where event_id = e.id and coach_id = v_coach) then continue; end if;
      insert into event_assignments (event_id, coach_id, source) values (e.id, v_coach, 'sprocket');
      perform schedule_log(v_batch, 'add', e.id, 'admin', v_reason, null, v_coach);
      v_changes := v_changes || ('added ' || schedule_coach_name(v_coach));
    end loop;
    for v_coach in select coach_id from event_assignments where event_id = e.id and not (coach_id = any(v_new_coaches)) loop
      delete from event_assignments where event_id = e.id and coach_id = v_coach;
      perform schedule_log(v_batch, 'remove', e.id, 'admin', v_reason, v_coach, null);
      v_changes := v_changes || ('removed ' || schedule_coach_name(v_coach));
    end loop;
  end if;

  -- Other Sprocket fields, from the first row.
  select id into v_field from fields where sprocket_field_id = nullif(trim(v_first ->> 'FieldID'), '');
  update events set
    is_private = lower(trim(coalesce(v_first ->> 'IsPrivate', ''))) = 'yes',
    opponent = case when coalesce(event_type, 'practice') = 'game' then nullif(trim(v_first ->> 'Opponent'), '') else opponent end,
    away_game = case when coalesce(event_type, 'practice') = 'game' then lower(trim(coalesce(v_first ->> 'AwayGame', ''))) = 'yes' else away_game end,
    arrival_minutes = coalesce(sprocket_arrival_minutes(v_first ->> 'ArrivalTime', start_time), arrival_minutes),
    field_id = coalesce(v_field, field_id)
  where id = e.id;

  -- What Sprocket has now (the 0035 trigger updates event_sprocket_rows).
  update events set
    sprocket_rows = p_rows,
    sprocket_event_ids = p_ids,
    sprocket_snapshot = coalesce(sprocket_snapshot, '{}'::jsonb) || (p_snapshot - 'coaches_complete')
      || case when coalesce((p_snapshot ->> 'coaches_complete')::boolean, false) then '{}'::jsonb
              else jsonb_build_object('coach_ids', coalesce(sprocket_snapshot -> 'coach_ids', '[]'::jsonb)) end
  where id = e.id;

  return jsonb_build_object('changes', to_jsonb(v_changes));
end;
$$;

-- p_rows: [{club_calendar_event_id, sprocket_row}] for this session.
-- p_sprocket_coach_ids: the coaches Sprocket's Notes name (mapped), or null
-- if not all could be mapped.
create or replace function sprocket_keep_app(p_event_id uuid, p_rows jsonb, p_sprocket_coach_ids uuid[]) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update event_sprocket_rows x
    set sprocket_row = u.sprocket_row
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as u(club_calendar_event_id text, sprocket_row jsonb)
  where x.club_calendar_event_id = u.club_calendar_event_id and x.event_id = p_event_id and x.state = 'linked';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'None of those Sprocket rows belong to this session -- reload and try again.' using errcode = '22023';
  end if;
  -- Imported sessions keep Sprocket's Notes wording unless the coaches
  -- differ from what Sprocket said; record what it says now so a different
  -- coach set gets written back.
  if p_sprocket_coach_ids is not null then
    update events set sprocket_snapshot = coalesce(sprocket_snapshot, '{}'::jsonb)
      || jsonb_build_object('coach_ids', to_jsonb(p_sprocket_coach_ids))
    where id = p_event_id;
  end if;
  return v_n;
end;
$$;

revoke execute on function sprocket_take_event(uuid, jsonb, jsonb, text[]), sprocket_keep_app(uuid, jsonb, uuid[]) from public, anon;
grant execute on function sprocket_take_event(uuid, jsonb, jsonb, text[]), sprocket_keep_app(uuid, jsonb, uuid[]) to authenticated;
