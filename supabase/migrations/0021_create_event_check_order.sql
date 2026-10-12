-- Found in R2b testing: schedule_create_event validated the reason BEFORE
-- checking permission, so a coach or out-of-scope scheduler who left the
-- reason blank got "A reason is required" instead of the refusal. Every
-- other schedule_* function checks permission first. Same body as 0020,
-- with the reason check moved after the role check.
create or replace function schedule_create_event(
  p_program_id uuid, p_location_id uuid, p_event_date date, p_start time, p_end time,
  p_session_name text, p_coach_ids uuid[], p_reason text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text;
  v_reason text;
  v_batch uuid := gen_random_uuid();
  v_event_id uuid;
  v_coach uuid;
begin
  if is_admin() then
    v_role := 'admin';
  elsif current_scheduler_id() is not null then
    if not is_scheduler_for_program_location(p_program_id, p_location_id) then
      raise exception 'Not allowed: you can''t create events for this program at this location.' using errcode = '42501';
    end if;
    v_role := 'scheduler';
  elsif current_coach_id() is not null then
    raise exception 'Not allowed: coaches can''t change the schedule. Use "Request swap" in My Sessions instead.'
      using errcode = '42501';
  else
    raise exception 'Not allowed: your account doesn''t have scheduling access.' using errcode = '42501';
  end if;

  v_reason := schedule_require_reason(p_reason);

  if p_event_date is null then
    raise exception 'A date is required.' using errcode = '22023';
  end if;
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_end <= p_start) then
    raise exception 'The end time has to be after the start time.' using errcode = '22023';
  end if;

  insert into events (program_id, location_id, event_date, start_time, end_time, session_name)
    values (p_program_id, p_location_id, p_event_date, p_start, p_end, nullif(btrim(p_session_name), ''))
    returning id into v_event_id;
  perform schedule_log(v_batch, 'create', v_event_id, v_role, v_reason, null, null, null, null, p_start, p_end);

  foreach v_coach in array coalesce(p_coach_ids, '{}') loop
    if not exists (select 1 from coaches where id = v_coach and is_active) then
      raise exception 'That coach isn''t on the active roster.' using errcode = '22023';
    end if;
    insert into event_assignments (event_id, coach_id, source) values (v_event_id, v_coach, 'manual')
      on conflict (event_id, coach_id) do nothing;
    perform schedule_log(v_batch, 'add', v_event_id, v_role, v_reason, null, v_coach);
  end loop;
  return v_batch;
end;
$$;
