-- Phase 9 step 2: create a session or a weekday series ("Saturdays 1/9 to
-- 3/13, not 1/16") in one go -- admins and schedulers alike (Justin,
-- 2026-11-22: schedulers may create whole series).
--
--   event_series              the rule a series was made from (weekdays,
--                             range, skip dates, times). events.series_id
--                             points at it for series made from now on;
--                             older series_id values (admin "weekly for N
--                             weeks") have no row here, which is fine.
--   schedule_create_sessions  creates every date in one transaction, with the
--                             0034 Sprocket fields and one event_sprocket_rows
--                             row per chosen Sprocket team (or one Club row),
--                             logged like schedule_create_event: admin
--                             changes reviewed, scheduler changes go to the
--                             review queue (one per session -- "Mark all
--                             reviewed" clears a series in one click).
--
-- Same permission rule as schedule_create_event: admins anywhere; a
-- scheduler only for a program/location they have a rule for.
--
-- Additive: new table + new function. The deployed code doesn't call it.

create table event_series (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs (id),
  location_id uuid not null references locations (id),
  weekdays int[] not null default '{}',
  first_date date not null,
  last_date date,
  skip_dates date[] not null default '{}',
  start_time time,
  end_time time,
  session_name text,
  created_by uuid,
  created_by_role text not null,
  created_at timestamptz not null default now()
);

alter table event_series enable row level security;
revoke all on event_series from anon, authenticated;
grant select on event_series to authenticated;
create policy "App users read event_series" on event_series for select using (has_app_role());

-- p_details (all optional):
--   event_type      practice | game | club | other  (default practice)
--   opponent, uniform, notes        text
--   away_game, is_private           boolean
--   arrival_minutes int 1-240       (a game is also PAID from arrival -- R3)
--   field_id        uuid (a field at this location)
--   team_ids        Sprocket team IDs for the session's rows; ignored for a
--                   Club session (one Club row instead). Absent = the
--                   program's default teams; [] = none.
--   series          {weekdays int[], first_date, last_date, skip_dates[]} --
--                   the rule the dates came from, stored when >1 date.
create or replace function schedule_create_sessions(
  p_program_id uuid, p_location_id uuid, p_dates date[], p_start time, p_end time,
  p_session_name text, p_coach_ids uuid[], p_reason text, p_details jsonb default '{}'
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text;
  v_reason text;
  v_batch uuid := gen_random_uuid();
  v_series uuid;
  v_event_id uuid;
  v_date date;
  v_coach uuid;
  v_team text;
  v_dates date[];
  v_type text := coalesce(nullif(p_details ->> 'event_type', ''), 'practice');
  v_arrival int := nullif(p_details ->> 'arrival_minutes', '')::int;
  v_field uuid := nullif(p_details ->> 'field_id', '')::uuid;
  v_teams text[];
  v_count int := 0;
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

  -- An admin may leave the reason blank (it's their own schedule); a
  -- scheduler's reason is shown to payroll on review.
  if v_role = 'admin' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    v_reason := 'Scheduled';
  else
    v_reason := schedule_require_reason(p_reason);
  end if;

  select array_agg(distinct d order by d) into v_dates from unnest(p_dates) d where d is not null;
  if v_dates is null then
    raise exception 'Pick at least one date.' using errcode = '22023';
  end if;
  if cardinality(v_dates) > 150 then
    raise exception 'That''s % sessions -- the most at once is 150. Split it into shorter series.', cardinality(v_dates)
      using errcode = '22023';
  end if;
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_end <= p_start) then
    raise exception 'The end time has to be after the start time.' using errcode = '22023';
  end if;
  if v_type not in ('practice', 'game', 'club', 'other') then
    raise exception 'Unknown session type "%".', v_type using errcode = '22023';
  end if;
  if v_arrival is not null and (v_arrival < 1 or v_arrival > 240) then
    raise exception 'Arrival has to be 1 to 240 minutes before the start.' using errcode = '22023';
  end if;
  if v_arrival is not null and p_start is null then
    raise exception 'An arrival time needs a start time.' using errcode = '22023';
  end if;
  if v_field is not null and not exists (select 1 from fields where id = v_field and location_id = p_location_id) then
    raise exception 'That field isn''t at this location.' using errcode = '22023';
  end if;
  if not exists (select 1 from programs where id = p_program_id and is_active) then
    raise exception 'That program isn''t active.' using errcode = '22023';
  end if;
  if not exists (select 1 from locations where id = p_location_id and is_active) then
    raise exception 'That location isn''t active.' using errcode = '22023';
  end if;

  if v_type = 'club' then
    v_teams := '{}';
  elsif p_details ? 'team_ids' then
    select coalesce(array_agg(distinct t), '{}') into v_teams
    from jsonb_array_elements_text(p_details -> 'team_ids') t;
    if exists (select 1 from unnest(v_teams) t
               where not exists (select 1 from sprocket_teams st where st.sprocket_team_id = t and st.is_active)) then
      raise exception 'One of the Sprocket teams isn''t on the Sprocket mappings list (or is inactive).' using errcode = '22023';
    end if;
  else
    select coalesce(array_agg(sprocket_team_id order by name), '{}') into v_teams
    from sprocket_teams where program_id = p_program_id and is_default and is_active;
  end if;

  if cardinality(v_dates) > 1 then
    insert into event_series (program_id, location_id, weekdays, first_date, last_date, skip_dates,
                              start_time, end_time, session_name, created_by, created_by_role)
    values (
      p_program_id, p_location_id,
      coalesce(array(select jsonb_array_elements_text(p_details -> 'series' -> 'weekdays')::int), '{}'),
      coalesce(nullif(p_details -> 'series' ->> 'first_date', '')::date, v_dates[1]),
      coalesce(nullif(p_details -> 'series' ->> 'last_date', '')::date, v_dates[cardinality(v_dates)]),
      coalesce(array(select jsonb_array_elements_text(p_details -> 'series' -> 'skip_dates')::date), '{}'),
      p_start, p_end, nullif(btrim(p_session_name), ''), auth.uid(), v_role
    )
    returning id into v_series;
  end if;

  foreach v_date in array v_dates loop
    insert into events (
      program_id, location_id, event_date, start_time, end_time, session_name, notes, series_id,
      event_type, opponent, away_game, uniform, is_private, arrival_minutes, field_id, paid_early_minutes
    ) values (
      p_program_id, p_location_id, v_date, p_start, p_end, nullif(btrim(p_session_name), ''),
      nullif(btrim(p_details ->> 'notes'), ''), v_series,
      v_type,
      case when v_type = 'game' then nullif(btrim(p_details ->> 'opponent'), '') end,
      v_type = 'game' and coalesce((p_details ->> 'away_game')::boolean, false),
      nullif(btrim(p_details ->> 'uniform'), ''),
      coalesce((p_details ->> 'is_private')::boolean, false),
      v_arrival, v_field,
      -- R3: a game is paid from its arrival (warm-up); anything else follows
      -- the program's rule (event override left blank).
      case when v_type = 'game' then v_arrival end
    )
    returning id into v_event_id;
    perform schedule_log(v_batch, 'create', v_event_id, v_role, v_reason, null, null, null, null, p_start, p_end);

    if v_type = 'club' then
      insert into event_sprocket_rows (event_id, sprocket_team_id, state) values (v_event_id, null, 'new');
    else
      foreach v_team in array v_teams loop
        insert into event_sprocket_rows (event_id, sprocket_team_id, state) values (v_event_id, v_team, 'new');
      end loop;
    end if;

    foreach v_coach in array coalesce(p_coach_ids, '{}') loop
      if not exists (select 1 from coaches where id = v_coach and is_active) then
        raise exception 'That coach isn''t on the active roster.' using errcode = '22023';
      end if;
      insert into event_assignments (event_id, coach_id, source) values (v_event_id, v_coach, 'manual')
        on conflict (event_id, coach_id) do nothing;
      perform schedule_log(v_batch, 'add', v_event_id, v_role, v_reason, null, v_coach);
    end loop;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('batch_id', v_batch, 'series_id', v_series, 'count', v_count);
end;
$$;

revoke execute on function schedule_create_sessions(uuid, uuid, date[], time, time, text, uuid[], text, jsonb) from public, anon;
grant execute on function schedule_create_sessions(uuid, uuid, date[], time, time, text, uuid[], text, jsonb) to authenticated;
