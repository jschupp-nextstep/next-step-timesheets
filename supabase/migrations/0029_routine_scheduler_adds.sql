-- R9 follow-up (Justin, 2026-10-14): a scheduler filling a not-yet-staffed
-- FUTURE session is routine -- it's logged but doesn't wait for review (and
-- so doesn't hold that session's pay). Everything else a scheduler does
-- (subs, removals, time changes, cancellations, adding to a session someone
-- else already staffed, anything today or in the past) still needs review.
--
-- "Not yet staffed" = every coach currently on the session was put there by a
-- routine add, so filling an empty session with several coaches stays routine
-- one add at a time.
--
-- Additive: new column + replaced function with the same signature, so the
-- deployed code keeps working before and after.

alter table schedule_changes add column if not exists routine boolean not null default false;

create or replace function schedule_add(p_event_id uuid, p_coach_id uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := schedule_assert_can_change(p_event_id);
  v_reason text := schedule_require_reason(p_reason);
  v_batch uuid := gen_random_uuid();
  v_change_id uuid;
  v_routine boolean := false;
begin
  if exists (select 1 from event_assignments where event_id = p_event_id and coach_id = p_coach_id) then
    raise exception '% is already assigned to this event.', schedule_coach_name(p_coach_id) using errcode = '22023';
  end if;
  if not exists (select 1 from coaches where id = p_coach_id and is_active) then
    raise exception 'That coach isn''t on the active roster.' using errcode = '22023';
  end if;

  if v_role = 'scheduler' then
    select
      e.event_date > (now() at time zone 'America/New_York')::date
      and not e.is_cancelled
      and not exists (
        select 1 from event_assignments a
        where a.event_id = p_event_id
          and not exists (
            select 1 from schedule_changes c
            where c.event_id = p_event_id and c.change_type = 'add'
              and c.added_coach_id = a.coach_id and c.routine and c.review_status <> 'reversed'
          )
      )
    into v_routine
    from events e where e.id = p_event_id;
  end if;

  insert into event_assignments (event_id, coach_id, source) values (p_event_id, p_coach_id, 'manual');
  v_change_id := schedule_log(v_batch, 'add', p_event_id, v_role, v_reason, null, p_coach_id);

  if v_routine then
    update schedule_changes
      set routine = true, review_status = 'reviewed', reviewed_at = now()
      where id = v_change_id;
  end if;
  return v_batch;
end;
$$;

revoke execute on function schedule_add(uuid, uuid, text) from public, anon;
grant execute on function schedule_add(uuid, uuid, text) to authenticated;
