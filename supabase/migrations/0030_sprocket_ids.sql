-- Sprocket re-import by Sprocket's own event ID (Oct 2026 fall import).
--
-- Sprocket's export carries ClubCalendarEventID on every row, and its import
-- template uses that same column as the key for updating an event, so it's
-- meant to be stable. Each event here now remembers:
--   * sprocket_event_ids -- the Sprocket row IDs it came from (an array:
--     a Camp event collapses one row per staff member);
--   * sprocket_rows      -- the raw rows, for exporting changes back later;
--   * sprocket_snapshot  -- what Sprocket said last time (date, times,
--     cancelled, coach ids), so a re-import can tell "Sprocket changed this"
--     from "someone changed it here".
--
-- Re-import rule (sprocket_sync_event): a field is updated only when Sprocket
-- changed it since the last import AND nobody changed it here in between;
-- otherwise the app's value is kept and the clash is reported. Coaches:
-- Sprocket adding a coach adds them; Sprocket dropping a coach removes them
-- only if that assignment came from Sprocket (manual/bulk/legacy ones are
-- kept and reported). Every change is logged in schedule_changes as an admin
-- change with reason "Sprocket re-import".
--
-- Additive only: the deployed importer never reads these columns.

alter table events
  add column if not exists sprocket_event_ids text[],
  add column if not exists sprocket_rows jsonb,
  add column if not exists sprocket_snapshot jsonb;

create index if not exists events_sprocket_event_ids_idx on events using gin (sprocket_event_ids);

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
