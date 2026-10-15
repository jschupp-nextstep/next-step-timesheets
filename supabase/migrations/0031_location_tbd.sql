-- Fall import follow-up (Justin, 2026-10-15): a session with no location
-- still imports, at "Location TBD", and a re-upload moves it once a real
-- location is mapped. Re-imports now also carry location, program, and
-- session name, under the same rule as times: changed only when Sprocket's
-- side changed since the last import (incl. a new mapping picked in the
-- importer) and nobody changed it here; otherwise kept and listed.
-- Logged as a new 'details' change type.
--
-- Additive: a new location row, a widened check constraint, and a replaced
-- function with the same signature.

insert into locations (name, category)
select 'Location TBD', 'regular'
where not exists (select 1 from locations where name = 'Location TBD');

do $$
declare c record;
begin
  -- The original inline check's name is generated; drop whichever one
  -- constrains change_type.
  for c in
    select conname from pg_constraint
    where conrelid = 'schedule_changes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%change_type%'
  loop
    execute format('alter table schedule_changes drop constraint %I', c.conname);
  end loop;
end $$;
alter table schedule_changes add constraint schedule_changes_change_type_check check (
  change_type in ('create', 'sub', 'add', 'remove', 'time', 'cancel', 'restore', 'details')
);

create or replace function sprocket_sync_event(
  p_event_id uuid,
  p_snapshot jsonb,   -- {event_date, start_time, end_time, is_cancelled, coach_ids[]}
  p_rows jsonb,
  p_ids text[]
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_reason constant text := 'Sprocket re-import';
  v_batch uuid := gen_random_uuid();
  e events%rowtype;
  old jsonb;
  v_changes text[] := '{}';
  v_conflicts text[] := '{}';
  v_new_date date := (p_snapshot ->> 'event_date')::date;
  v_new_start time := (p_snapshot ->> 'start_time')::time;
  v_new_end time := (p_snapshot ->> 'end_time')::time;
  v_new_cancelled boolean := (p_snapshot ->> 'is_cancelled')::boolean;
  v_old_coaches uuid[];
  v_new_coaches uuid[];
  v_coach uuid;
  v_source text;
  v_label text;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can import from Sprocket.' using errcode = '42501';
  end if;
  select * into e from events where id = p_event_id for update;
  if not found then
    raise exception 'That event no longer exists.' using errcode = 'P0002';
  end if;
  old := e.sprocket_snapshot;
  v_label := to_char(e.event_date, 'FMMM/FMDD') || coalesce(' ' || e.session_name, '');

  -- Date + times move together (one logged 'time' change).
  if old is null
     or (old ->> 'event_date')::date is distinct from v_new_date
     or (old ->> 'start_time')::time is distinct from v_new_start
     or (old ->> 'end_time')::time is distinct from v_new_end then
    if e.event_date = v_new_date and e.start_time is not distinct from v_new_start
       and e.end_time is not distinct from v_new_end then
      null; -- already matches
    elsif old is null
       or (e.event_date = (old ->> 'event_date')::date
           and e.start_time is not distinct from (old ->> 'start_time')::time
           and e.end_time is not distinct from (old ->> 'end_time')::time) then
      perform set_config('app.schedule_change_logged', 'on', true);
      update events set event_date = v_new_date, start_time = v_new_start, end_time = v_new_end where id = e.id;
      perform set_config('app.schedule_change_logged', 'off', true);
      perform schedule_log(v_batch, 'time', e.id, 'admin',
        v_reason || case when e.event_date <> v_new_date
          then ' (moved from ' || to_char(e.event_date, 'FMMM/FMDD') || ' to ' || to_char(v_new_date, 'FMMM/FMDD') || ')'
          else '' end,
        null, null, e.start_time, e.end_time, v_new_start, v_new_end);
      v_changes := v_changes || (v_label || ': time/date updated');
    else
      v_conflicts := v_conflicts || (v_label || ': Sprocket changed the date/time, but it was also changed here -- kept this app''s');
    end if;
  end if;

  -- Cancelled / restored.
  if old is null or (old ->> 'is_cancelled')::boolean is distinct from v_new_cancelled then
    if e.is_cancelled = v_new_cancelled then
      null;
    elsif old is null or e.is_cancelled = (old ->> 'is_cancelled')::boolean then
      perform set_config('app.schedule_change_logged', 'on', true);
      update events set is_cancelled = v_new_cancelled,
        cancellation_timing = case when v_new_cancelled then cancellation_timing else null end
        where id = e.id;
      perform set_config('app.schedule_change_logged', 'off', true);
      perform schedule_log(v_batch, case when v_new_cancelled then 'cancel' else 'restore' end, e.id, 'admin',
        case when v_new_cancelled then 'Cancelled in Sprocket' else 'Restored in Sprocket' end);
      v_changes := v_changes || (v_label || case when v_new_cancelled then ': cancelled' else ': restored' end);
    else
      v_conflicts := v_conflicts || (v_label || ': Sprocket ' || case when v_new_cancelled then 'cancelled' else 'restored' end
        || ' it, but it was changed here -- kept this app''s');
    end if;
  end if;

  -- Location / program / session name (one logged 'details' change).
  declare
    v_new_loc uuid := (p_snapshot ->> 'location_id')::uuid;
    v_new_prog uuid := (p_snapshot ->> 'program_id')::uuid;
    v_new_name text := p_snapshot ->> 'session_name';
    -- Snapshots from before 0031 have no such keys: treat the current values
    -- as what Sprocket said last time.
    v_old_loc uuid := coalesce((old ->> 'location_id')::uuid, e.location_id);
    v_old_prog uuid := coalesce((old ->> 'program_id')::uuid, e.program_id);
    v_old_name text := case when old ? 'session_name' then old ->> 'session_name' else e.session_name end;
    v_parts text[] := '{}';
    v_clash text[] := '{}';
    v_set_loc boolean := false;
    v_set_prog boolean := false;
    v_set_name boolean := false;
  begin
    if v_new_loc is not null and v_new_loc is distinct from v_old_loc and v_new_loc is distinct from e.location_id then
      if e.location_id = v_old_loc then
        v_set_loc := true;
        v_parts := v_parts || ('location ' || coalesce((select name from locations where id = e.location_id), '?')
          || ' → ' || coalesce((select name from locations where id = v_new_loc), '?'));
      else
        v_clash := v_clash || 'location'::text;
      end if;
    end if;
    if v_new_prog is not null and v_new_prog is distinct from v_old_prog and v_new_prog is distinct from e.program_id then
      if e.program_id = v_old_prog then
        v_set_prog := true;
        v_parts := v_parts || ('program ' || coalesce((select name from programs where id = e.program_id), '?')
          || ' → ' || coalesce((select name from programs where id = v_new_prog), '?'));
      else
        v_clash := v_clash || 'program'::text;
      end if;
    end if;
    if p_snapshot ? 'session_name' and v_new_name is distinct from v_old_name and v_new_name is distinct from e.session_name then
      if e.session_name is not distinct from v_old_name then
        v_set_name := true;
        v_parts := v_parts || ('name "' || coalesce(e.session_name, '') || '" → "' || coalesce(v_new_name, '') || '"');
      else
        v_clash := v_clash || 'session name'::text;
      end if;
    end if;

    if array_length(v_parts, 1) > 0 then
      update events set
        location_id = case when v_set_loc then v_new_loc else location_id end,
        program_id = case when v_set_prog then v_new_prog else program_id end,
        session_name = case when v_set_name then v_new_name else session_name end
        where id = e.id;
      perform schedule_log(v_batch, 'details', e.id, 'admin', v_reason || ': ' || array_to_string(v_parts, '; '));
      v_changes := v_changes || (v_label || ': ' || array_to_string(v_parts, '; '));
    end if;
    if array_length(v_clash, 1) > 0 then
      v_conflicts := v_conflicts || (v_label || ': Sprocket changed the ' || array_to_string(v_clash, ', ')
        || ', but it was also changed here -- kept this app''s');
    end if;
  end;

  -- Coaches: act only on what Sprocket changed since the last import.
  v_old_coaches := coalesce(array(select jsonb_array_elements_text(old -> 'coach_ids'))::uuid[], '{}');
  v_new_coaches := coalesce(array(select jsonb_array_elements_text(p_snapshot -> 'coach_ids'))::uuid[], '{}');

  foreach v_coach in array v_new_coaches loop
    if v_coach = any(v_old_coaches) then continue; end if;
    if exists (select 1 from event_assignments where event_id = e.id and coach_id = v_coach) then continue; end if;
    if not exists (select 1 from coaches where id = v_coach and is_active) then
      v_conflicts := v_conflicts || (v_label || ': Sprocket added ' || schedule_coach_name(v_coach) || ', who isn''t on the active roster');
      continue;
    end if;
    insert into event_assignments (event_id, coach_id, source) values (e.id, v_coach, 'sprocket');
    perform schedule_log(v_batch, 'add', e.id, 'admin', v_reason, null, v_coach);
    v_changes := v_changes || (v_label || ': added ' || schedule_coach_name(v_coach));
  end loop;

  foreach v_coach in array v_old_coaches loop
    if v_coach = any(v_new_coaches) then continue; end if;
    select source into v_source from event_assignments where event_id = e.id and coach_id = v_coach;
    if not found then continue; end if;
    if v_source = 'sprocket' then
      delete from event_assignments where event_id = e.id and coach_id = v_coach;
      perform schedule_log(v_batch, 'remove', e.id, 'admin', v_reason, v_coach, null);
      v_changes := v_changes || (v_label || ': removed ' || schedule_coach_name(v_coach));
    else
      v_conflicts := v_conflicts || (v_label || ': Sprocket dropped ' || schedule_coach_name(v_coach)
        || ', but they were assigned here -- kept');
    end if;
  end loop;

  update events
    set sprocket_snapshot = p_snapshot, sprocket_rows = p_rows, sprocket_event_ids = p_ids
    where id = e.id;

  return jsonb_build_object('changes', to_jsonb(v_changes), 'conflicts', to_jsonb(v_conflicts));
end;
$$;

revoke execute on function sprocket_sync_event(uuid, jsonb, jsonb, text[]) from public, anon;
grant execute on function sprocket_sync_event(uuid, jsonb, jsonb, text[]) to authenticated;
