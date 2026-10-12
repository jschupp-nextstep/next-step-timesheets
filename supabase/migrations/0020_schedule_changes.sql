-- R2b: logged schedule changes.
--
-- Every on-the-fly change (sub, add, remove, time, cancel/restore, create)
-- goes through one of the schedule_* functions below. Each one, in a single
-- transaction: checks permission (raising a clear error if the caller isn't
-- allowed -- never a silent no-op), applies the change, and appends a row to
-- schedule_changes. event_assignments stays "who's working now"; history
-- lives only in schedule_changes, so the existing readers of
-- event_assignments (My Sessions, the Band A picker, Reconciliation, the
-- board, claims) don't need a "skip removed rows" filter.
--
-- Scheduler changes land as review_status = 'needs_review'; admin changes
-- are 'reviewed' immediately. The review queue and payroll hold are R2c.

-- 1. Provenance + coverage on assignments.
-- 'legacy' = existed before this migration, origin unknown (Sprocket import,
-- bulk import, or the board -- nothing recorded it). The Sprocket importer
-- upgrade treats legacy like manual: kept, and listed as a conflict, never
-- silently replaced.
alter table event_assignments
  add column source text not null default 'manual'
    check (source in ('sprocket', 'bulk', 'manual', 'legacy')),
  add column covering_for_coach_id uuid references coaches (id);
update event_assignments set source = 'legacy';

-- 2. The change log. Append-only: no insert/update/delete grants to anyone
-- through the API; only the security-definer functions below write it.
create table schedule_changes (
  id uuid primary key default gen_random_uuid(),
  -- Rows written by one action share a batch_id (a series time change, or
  -- a create that also assigns coaches).
  batch_id uuid not null default gen_random_uuid(),
  change_type text not null check (
    change_type in ('create', 'sub', 'add', 'remove', 'time', 'cancel', 'restore')
  ),
  -- Cascade so the admin Events screen can still delete an event (e.g. a
  -- mistaken import); its history goes with it.
  event_id uuid not null references events (id) on delete cascade,
  removed_coach_id uuid references coaches (id),
  added_coach_id uuid references coaches (id),
  old_start_time time,
  old_end_time time,
  new_start_time time,
  new_end_time time,
  reason text not null check (length(btrim(reason)) > 0),
  changed_by uuid not null,
  changed_by_email text not null,
  changed_by_role text not null check (changed_by_role in ('admin', 'scheduler')),
  changed_at timestamptz not null default now(),
  review_status text not null check (review_status in ('needs_review', 'reviewed', 'reversed')),
  reviewed_by uuid,
  reviewed_at timestamptz
);

create index schedule_changes_event_idx on schedule_changes (event_id, changed_at);
create index schedule_changes_review_idx on schedule_changes (review_status, changed_at);

alter table schedule_changes enable row level security;
revoke all on schedule_changes from anon, authenticated;
grant select on schedule_changes to authenticated;
-- R2c's review actions (mark reviewed / reverse) will be functions too.

create policy "Admins read schedule_changes" on schedule_changes
  for select using (is_admin());
create policy "Schedulers read in-scope schedule_changes" on schedule_changes
  for select using (is_scheduler_for_event(event_id) or changed_by = auth.uid());

-- 3. Permission check shared by every schedule_* function. Returns the
-- caller's role for the log row, or raises -- with a message written for a
-- person, since the UI shows it verbatim. errcode 42501
-- (insufficient_privilege) makes PostgREST answer 403.
create or replace function schedule_assert_can_change(p_event_id uuid) returns text
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not exists (select 1 from events where id = p_event_id) then
    raise exception 'That event no longer exists.' using errcode = 'P0002';
  end if;
  if is_admin() then
    return 'admin';
  end if;
  if current_scheduler_id() is not null then
    if is_scheduler_for_event(p_event_id) then
      return 'scheduler';
    end if;
    raise exception 'Not allowed: you don''t manage this event.' using errcode = '42501';
  end if;
  if current_coach_id() is not null then
    raise exception 'Not allowed: coaches can''t change the schedule. Use "Request swap" in My Sessions instead.'
      using errcode = '42501';
  end if;
  raise exception 'Not allowed: your account doesn''t have scheduling access.' using errcode = '42501';
end;
$$;

create or replace function schedule_require_reason(p_reason text) returns text
language plpgsql immutable
as $$
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required for every schedule change.' using errcode = '22023';
  end if;
  return btrim(p_reason);
end;
$$;

create or replace function schedule_coach_name(p_coach_id uuid) returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce((select name from coaches where id = p_coach_id), 'That coach');
$$;

create or replace function schedule_log(
  p_batch_id uuid, p_change_type text, p_event_id uuid, p_role text, p_reason text,
  p_removed uuid default null, p_added uuid default null,
  p_old_start time default null, p_old_end time default null,
  p_new_start time default null, p_new_end time default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into schedule_changes (
    batch_id, change_type, event_id, removed_coach_id, added_coach_id,
    old_start_time, old_end_time, new_start_time, new_end_time, reason,
    changed_by, changed_by_email, changed_by_role, review_status, reviewed_by, reviewed_at
  ) values (
    p_batch_id, p_change_type, p_event_id, p_removed, p_added,
    p_old_start, p_old_end, p_new_start, p_new_end, p_reason,
    auth.uid(), lower(auth.jwt() ->> 'email'), p_role,
    case when p_role = 'admin' then 'reviewed' else 'needs_review' end,
    case when p_role = 'admin' then auth.uid() end,
    case when p_role = 'admin' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

-- 4. The quick actions. Each returns its batch_id.

-- Sub: the replacement takes the original coach's place and is marked as
-- covering for them (R5's double-pay flag reads covering_for_coach_id).
create or replace function schedule_sub(p_event_id uuid, p_out_coach_id uuid, p_in_coach_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := schedule_assert_can_change(p_event_id);
  v_reason text := schedule_require_reason(p_reason);
  v_batch uuid := gen_random_uuid();
begin
  if p_out_coach_id = p_in_coach_id then
    raise exception 'Pick a different coach to sub in.' using errcode = '22023';
  end if;
  if not exists (select 1 from event_assignments where event_id = p_event_id and coach_id = p_out_coach_id) then
    raise exception '% isn''t assigned to this event.', schedule_coach_name(p_out_coach_id) using errcode = '22023';
  end if;
  if exists (select 1 from event_assignments where event_id = p_event_id and coach_id = p_in_coach_id) then
    raise exception '% is already assigned to this event.', schedule_coach_name(p_in_coach_id) using errcode = '22023';
  end if;
  if not exists (select 1 from coaches where id = p_in_coach_id and is_active) then
    raise exception 'That coach isn''t on the active roster.' using errcode = '22023';
  end if;

  delete from event_assignments where event_id = p_event_id and coach_id = p_out_coach_id;
  insert into event_assignments (event_id, coach_id, source, covering_for_coach_id)
    values (p_event_id, p_in_coach_id, 'manual', p_out_coach_id);
  perform schedule_log(v_batch, 'sub', p_event_id, v_role, v_reason, p_out_coach_id, p_in_coach_id);
  return v_batch;
end;
$$;

create or replace function schedule_add(p_event_id uuid, p_coach_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := schedule_assert_can_change(p_event_id);
  v_reason text := schedule_require_reason(p_reason);
  v_batch uuid := gen_random_uuid();
begin
  if exists (select 1 from event_assignments where event_id = p_event_id and coach_id = p_coach_id) then
    raise exception '% is already assigned to this event.', schedule_coach_name(p_coach_id) using errcode = '22023';
  end if;
  if not exists (select 1 from coaches where id = p_coach_id and is_active) then
    raise exception 'That coach isn''t on the active roster.' using errcode = '22023';
  end if;

  insert into event_assignments (event_id, coach_id, source) values (p_event_id, p_coach_id, 'manual');
  perform schedule_log(v_batch, 'add', p_event_id, v_role, v_reason, null, p_coach_id);
  return v_batch;
end;
$$;

-- Removing never touches timesheet_entries: a coach removed after confirming
-- hours keeps their entry, which Reconciliation already flags as "not
-- assigned" and R2c's payroll hold keeps out of Payment Due until reviewed.
create or replace function schedule_remove(p_event_id uuid, p_coach_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := schedule_assert_can_change(p_event_id);
  v_reason text := schedule_require_reason(p_reason);
  v_batch uuid := gen_random_uuid();
begin
  if not exists (select 1 from event_assignments where event_id = p_event_id and coach_id = p_coach_id) then
    raise exception '% isn''t assigned to this event.', schedule_coach_name(p_coach_id) using errcode = '22023';
  end if;

  delete from event_assignments where event_id = p_event_id and coach_id = p_coach_id;
  perform schedule_log(v_batch, 'remove', p_event_id, v_role, v_reason, p_coach_id, null);
  return v_batch;
end;
$$;

-- Time change for this event, or this and every later event in its series.
-- For a series, the caller must manage EVERY affected event -- all or
-- nothing, so a scheduler can't half-apply a change and not notice.
create or replace function schedule_change_time(
  p_event_id uuid, p_new_start time, p_new_end time, p_reason text, p_apply_to_series boolean default false
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := schedule_assert_can_change(p_event_id);
  v_reason text := schedule_require_reason(p_reason);
  v_batch uuid := gen_random_uuid();
  v_event events%rowtype;
  v_target events%rowtype;
  v_total int;
  v_allowed int;
begin
  if p_new_start is null or p_new_end is null or p_new_end <= p_new_start then
    raise exception 'The end time has to be after the start time.' using errcode = '22023';
  end if;
  select * into v_event from events where id = p_event_id;

  if p_apply_to_series and v_event.series_id is null then
    raise exception 'This event isn''t part of a series.' using errcode = '22023';
  end if;

  if p_apply_to_series and v_role = 'scheduler' then
    select count(*), count(*) filter (where is_scheduler_for_event(id))
      into v_total, v_allowed
      from events where series_id = v_event.series_id and event_date >= v_event.event_date;
    if v_allowed < v_total then
      raise exception 'Not allowed: you manage % of the % events from here on in this series, so nothing was changed.',
        v_allowed, v_total using errcode = '42501';
    end if;
  end if;

  for v_target in
    select * from events
    where case when p_apply_to_series then series_id = v_event.series_id and event_date >= v_event.event_date
               else id = p_event_id end
    order by event_date
  loop
    if v_target.start_time is distinct from p_new_start or v_target.end_time is distinct from p_new_end then
      -- Tells the events audit trigger (below) this change is already logged.
      perform set_config('app.schedule_change_logged', 'on', true);
      update events set start_time = p_new_start, end_time = p_new_end where id = v_target.id;
      perform set_config('app.schedule_change_logged', 'off', true);
      perform schedule_log(v_batch, 'time', v_target.id, v_role, v_reason, null, null,
        v_target.start_time, v_target.end_time, p_new_start, p_new_end);
    end if;
  end loop;
  return v_batch;
end;
$$;

-- Single-event cancel/restore. Whole-day cancellation and cancellation
-- timing are R6; this is the quick action on one event.
create or replace function schedule_set_cancelled(p_event_id uuid, p_cancelled boolean, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := schedule_assert_can_change(p_event_id);
  v_reason text := schedule_require_reason(p_reason);
  v_batch uuid := gen_random_uuid();
begin
  if (select is_cancelled from events where id = p_event_id) = p_cancelled then
    raise exception 'This event is already %.', case when p_cancelled then 'cancelled' else 'active' end
      using errcode = '22023';
  end if;
  perform set_config('app.schedule_change_logged', 'on', true);
  update events set is_cancelled = p_cancelled where id = p_event_id;
  perform set_config('app.schedule_change_logged', 'off', true);
  perform schedule_log(v_batch, case when p_cancelled then 'cancel' else 'restore' end, p_event_id, v_role, v_reason);
  return v_batch;
end;
$$;

-- Create a one-off event, optionally with coaches. Schedulers need a
-- program/location rule for it -- a coach rule can't authorize creation.
create or replace function schedule_create_event(
  p_program_id uuid, p_location_id uuid, p_event_date date, p_start time, p_end time,
  p_session_name text, p_coach_ids uuid[], p_reason text
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text;
  v_reason text := schedule_require_reason(p_reason);
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

-- 5. Admin edits made outside the functions (the generic Edit Event form)
-- still get logged, so "time changed after hours were confirmed" is visible
-- whichever screen changed it. Skipped when a schedule_* function already
-- logged the change. Imports only INSERT events, so they never fire this.
create or replace function log_direct_event_change() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.schedule_change_logged', true), 'off') = 'on' then
    return new;
  end if;
  if auth.uid() is null then
    return new; -- SQL Editor / service role: not a person using the app.
  end if;
  if old.start_time is distinct from new.start_time or old.end_time is distinct from new.end_time then
    perform schedule_log(gen_random_uuid(), 'time', new.id, 'admin', 'Edited on the Events screen', null, null,
      old.start_time, old.end_time, new.start_time, new.end_time);
  end if;
  if old.is_cancelled is distinct from new.is_cancelled then
    perform schedule_log(gen_random_uuid(), case when new.is_cancelled then 'cancel' else 'restore' end,
      new.id, 'admin', 'Edited on the Events screen');
  end if;
  return new;
end;
$$;

create trigger events_log_direct_change
  after update on events
  for each row execute function log_direct_event_change();

-- 6. Execute rights: signed-in users only (the functions themselves decide
-- who may actually change what). Internal helpers aren't callable at all.
revoke execute on function
  schedule_assert_can_change(uuid), schedule_require_reason(text), schedule_coach_name(uuid),
  schedule_log(uuid, text, uuid, text, text, uuid, uuid, time, time, time, time),
  log_direct_event_change(),
  schedule_sub(uuid, uuid, uuid, text), schedule_add(uuid, uuid, text), schedule_remove(uuid, uuid, text),
  schedule_change_time(uuid, time, time, text, boolean), schedule_set_cancelled(uuid, boolean, text),
  schedule_create_event(uuid, uuid, date, time, time, text, uuid[], text)
from public, anon;
grant execute on function
  schedule_sub(uuid, uuid, uuid, text), schedule_add(uuid, uuid, text), schedule_remove(uuid, uuid, text),
  schedule_change_time(uuid, time, time, text, boolean), schedule_set_cancelled(uuid, boolean, text),
  schedule_create_event(uuid, uuid, date, time, time, text, uuid[], text)
to authenticated;
