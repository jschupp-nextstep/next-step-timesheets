-- R2c: reviewing scheduler changes. Purely additive (two new functions), so
-- it's safe with the deployed code either way (see "Migration ↔ deploy
-- rule" in CLAUDE.md).
--
-- The payroll hold itself needs no schema: an entry is held while its event
-- has any schedule_changes row in 'needs_review' -- computed by the shared
-- partition in src/utility/payrollFilters.ts, used by Payment Due and the
-- Zoho export alike.

create or replace function schedule_assert_admin(p_action text) returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can % schedule changes.', p_action using errcode = '42501';
  end if;
end;
$$;

-- Mark one or more scheduler changes reviewed. Rows already reviewed or
-- reversed are left alone (not an error -- two admins clicking at once is
-- harmless). Returns how many rows actually changed.
create or replace function schedule_mark_reviewed(p_change_ids uuid[]) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform schedule_assert_admin('review');
  update schedule_changes
    set review_status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now()
    where id = any(p_change_ids) and review_status = 'needs_review';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Undo one change by applying its inverse, logged as a new admin change
-- (reason prefixed "Reversed: "), and mark the original 'reversed'. Refuses
-- -- with a reason, never half-applying -- when the schedule has moved on
-- since (e.g. the sub was already subbed out again, or the time was changed
-- again), so a reversal can't silently clobber a later change. Reversing a
-- 'create' cancels the event rather than deleting it, since entries may
-- already point at it.
create or replace function schedule_reverse(p_change_id uuid, p_reason text) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  c schedule_changes%rowtype;
  v_reason text;
  v_batch uuid := gen_random_uuid();
  v_event events%rowtype;
begin
  perform schedule_assert_admin('reverse');
  v_reason := 'Reversed: ' || schedule_require_reason(p_reason);

  select * into c from schedule_changes where id = p_change_id for update;
  if not found then
    raise exception 'That change no longer exists.' using errcode = 'P0002';
  end if;
  if c.review_status = 'reversed' then
    raise exception 'That change was already reversed.' using errcode = '22023';
  end if;
  select * into v_event from events where id = c.event_id;

  perform set_config('app.schedule_change_logged', 'on', true);

  if c.change_type in ('sub', 'add') then
    if not exists (select 1 from event_assignments where event_id = c.event_id and coach_id = c.added_coach_id) then
      raise exception 'Can''t reverse: % is no longer on this event (it changed again since).',
        schedule_coach_name(c.added_coach_id) using errcode = '22023';
    end if;
    delete from event_assignments where event_id = c.event_id and coach_id = c.added_coach_id;
    perform schedule_log(v_batch, 'remove', c.event_id, 'admin', v_reason, c.added_coach_id, null);
  end if;

  if c.change_type in ('sub', 'remove') then
    if exists (select 1 from event_assignments where event_id = c.event_id and coach_id = c.removed_coach_id) then
      raise exception 'Can''t reverse: % is already back on this event.',
        schedule_coach_name(c.removed_coach_id) using errcode = '22023';
    end if;
    insert into event_assignments (event_id, coach_id, source) values (c.event_id, c.removed_coach_id, 'manual');
    perform schedule_log(v_batch, 'add', c.event_id, 'admin', v_reason, null, c.removed_coach_id);
  end if;

  if c.change_type = 'time' then
    if v_event.start_time is distinct from c.new_start_time or v_event.end_time is distinct from c.new_end_time then
      raise exception 'Can''t reverse: the time was changed again since. Reverse the later change first.'
        using errcode = '22023';
    end if;
    update events set start_time = c.old_start_time, end_time = c.old_end_time where id = c.event_id;
    perform schedule_log(v_batch, 'time', c.event_id, 'admin', v_reason, null, null,
      c.new_start_time, c.new_end_time, c.old_start_time, c.old_end_time);
  end if;

  if c.change_type in ('cancel', 'restore', 'create') then
    -- cancel -> restore; restore -> cancel; create -> cancel.
    if v_event.is_cancelled = (c.change_type <> 'cancel') then
      raise exception 'Can''t reverse: the session is already %.',
        case when v_event.is_cancelled then 'cancelled' else 'active' end using errcode = '22023';
    end if;
    update events set is_cancelled = (c.change_type <> 'cancel') where id = c.event_id;
    perform schedule_log(v_batch, case when c.change_type = 'cancel' then 'restore' else 'cancel' end,
      c.event_id, 'admin', v_reason);
  end if;

  perform set_config('app.schedule_change_logged', 'off', true);

  update schedule_changes
    set review_status = 'reversed', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_change_id;
  return v_batch;
end;
$$;

revoke execute on function schedule_assert_admin(text), schedule_mark_reviewed(uuid[]), schedule_reverse(uuid, text)
  from public, anon;
grant execute on function schedule_mark_reviewed(uuid[]), schedule_reverse(uuid, text) to authenticated;
