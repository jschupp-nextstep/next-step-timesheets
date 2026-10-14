-- R6: cancellations. Cancel a whole day in one step, record when a
-- cancellation happened, and stop paying entries on canceled sessions by
-- default (payroll rule settled in the Sep–Oct run: canceled sessions aren't
-- paid, except in extraordinary cases such as a coach who wasn't told and
-- showed up).
--
-- Run together with the matching push: mark_entries_paid starts refusing
-- entries on canceled sessions, which the deployed Payment Due still shows
-- as payable.

-- 1. When a cancellation happened.
alter table events
  add column cancellation_timing text check (cancellation_timing in ('in_advance', 'same_day', 'after_arrival'));

-- 2. Paying an entry on a canceled session is an explicit admin exception.
alter table timesheet_entries
  add column canceled_event_pay_approved boolean not null default false;

-- Admin-only, like admin_flag (extends 0025's trigger function).
create or replace function protect_admin_flag() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    if tg_op = 'INSERT' then
      new.admin_flag := null;
      new.admin_flag_reason := null;
      new.admin_flagged_at := null;
      new.canceled_event_pay_approved := false;
    else
      new.admin_flag := old.admin_flag;
      new.admin_flag_reason := old.admin_flag_reason;
      new.admin_flagged_at := old.admin_flagged_at;
      new.canceled_event_pay_approved := old.canceled_event_pay_approved;
    end if;
  end if;
  return new;
end;
$$;

-- 3. Single-event cancel/restore, now recording timing. Replaces 0020's
-- 3-argument version; the 4th argument defaults so callers using the old
-- shape (the deployed code) still resolve to it.
drop function schedule_set_cancelled(uuid, boolean, text);
create or replace function schedule_set_cancelled(
  p_event_id uuid, p_cancelled boolean, p_reason text, p_timing text default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := schedule_assert_can_change(p_event_id);
  v_reason text := schedule_require_reason(p_reason);
  v_batch uuid := gen_random_uuid();
begin
  if p_timing is not null and p_timing not in ('in_advance', 'same_day', 'after_arrival') then
    raise exception 'Unknown cancellation timing.' using errcode = '22023';
  end if;
  if (select is_cancelled from events where id = p_event_id) = p_cancelled then
    raise exception 'This event is already %.', case when p_cancelled then 'cancelled' else 'active' end
      using errcode = '22023';
  end if;
  perform set_config('app.schedule_change_logged', 'on', true);
  update events
    set is_cancelled = p_cancelled,
        cancellation_timing = case when p_cancelled then p_timing else null end
    where id = p_event_id;
  perform set_config('app.schedule_change_logged', 'off', true);
  perform schedule_log(v_batch, case when p_cancelled then 'cancel' else 'restore' end, p_event_id, v_role, v_reason);
  return v_batch;
end;
$$;

-- 4. Cancel a whole day (storms, holidays) in one step, for all programs or
-- just some. An admin cancels every matching session; a scheduler cancels
-- the matching sessions they manage (their changes land in the review queue
-- as usual). Returns how many were cancelled; refuses if none matched.
create or replace function schedule_cancel_day(
  p_date date, p_program_ids uuid[], p_reason text, p_timing text
) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_reason text;
  v_role text;
  v_batch uuid := gen_random_uuid();
  v_event events%rowtype;
  v_count int := 0;
begin
  if is_admin() then
    v_role := 'admin';
  elsif current_scheduler_id() is not null then
    v_role := 'scheduler';
  elsif current_coach_id() is not null then
    raise exception 'Not allowed: coaches can''t change the schedule.' using errcode = '42501';
  else
    raise exception 'Not allowed: your account doesn''t have scheduling access.' using errcode = '42501';
  end if;
  v_reason := schedule_require_reason(p_reason);
  if p_date is null then
    raise exception 'Pick the day to cancel.' using errcode = '22023';
  end if;
  if p_timing is null or p_timing not in ('in_advance', 'same_day', 'after_arrival') then
    raise exception 'Say when it was cancelled (in advance, same day, or after arrival).' using errcode = '22023';
  end if;

  for v_event in
    select * from events
    where event_date = p_date and not is_cancelled
      and (p_program_ids is null or cardinality(p_program_ids) = 0 or program_id = any(p_program_ids))
      and (v_role = 'admin' or is_scheduler_for_event(id))
    order by start_time nulls first
  loop
    perform set_config('app.schedule_change_logged', 'on', true);
    update events set is_cancelled = true, cancellation_timing = p_timing where id = v_event.id;
    perform set_config('app.schedule_change_logged', 'off', true);
    perform schedule_log(v_batch, 'cancel', v_event.id, v_role, v_reason);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'There are no active sessions% on that day to cancel.',
      case when v_role = 'scheduler' then ' you manage' else '' end using errcode = '22023';
  end if;
  return v_count;
end;
$$;

-- 5. The exception: pay an entry on a canceled session anyway. The reason is
-- posted to the entry's thread so the coach sees why it was paid.
create or replace function approve_canceled_event_pay(p_entry_id uuid, p_reason text) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e timesheet_entries%rowtype;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can do that.' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Say why this is being paid despite the cancellation -- the coach sees it.' using errcode = '22023';
  end if;
  select * into e from timesheet_entries where id = p_entry_id for update;
  if not found then raise exception 'That entry no longer exists.' using errcode = 'P0002'; end if;
  if e.status <> 'pending' then
    raise exception 'This entry has already been paid.' using errcode = '22023';
  end if;
  if not exists (select 1 from events where id = e.event_id and is_cancelled) then
    raise exception 'This entry''s session isn''t cancelled.' using errcode = '22023';
  end if;
  perform entry_message_post(p_entry_id, 'admin', 'Paid as an exception to the cancellation: ' || btrim(p_reason));
  update timesheet_entries set canceled_event_pay_approved = true where id = p_entry_id;
end;
$$;

-- 6. Mark all paid never pays an entry on a canceled session unless the
-- exception was approved (adds that to 0025's version).
create or replace function mark_entries_paid(p_rows jsonb, p_paid_date date, p_range_start date, p_range_end date)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_expected int := jsonb_array_length(p_rows);
  v_updated int;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can mark entries paid.' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where (r ->> 'paid_amount') is null) then
    raise exception 'Every entry needs an amount before it can be marked paid. Nothing was changed.' using errcode = '22023';
  end if;

  update timesheet_entries e
    set status = 'paid',
        paid_date = p_paid_date,
        paid_rate = (r ->> 'paid_rate')::numeric,
        paid_amount = (r ->> 'paid_amount')::numeric,
        paid_rate_basis = r ->> 'paid_rate_basis'
    from jsonb_array_elements(p_rows) r
    where e.id = (r ->> 'id')::uuid
      and e.status = 'pending'
      and e.admin_flag is null
      and e.entry_date between p_range_start and p_range_end
      and not exists (
        select 1 from schedule_changes c where c.event_id = e.event_id and c.review_status = 'needs_review'
      )
      and (
        e.canceled_event_pay_approved
        or not exists (select 1 from events ev where ev.id = e.event_id and ev.is_cancelled)
      );
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception '% of % entries could not be marked paid (no longer pending, on hold or excluded, on a canceled session, outside the range, or held for schedule review). Nothing was changed.',
      v_expected - v_updated, v_expected using errcode = '22023';
  end if;
  return v_updated;
end;
$$;

revoke execute on function
  schedule_set_cancelled(uuid, boolean, text, text), schedule_cancel_day(date, uuid[], text, text),
  approve_canceled_event_pay(uuid, text)
from public, anon;
grant execute on function
  schedule_set_cancelled(uuid, boolean, text, text), schedule_cancel_day(date, uuid[], text, text),
  approve_canceled_event_pay(uuid, text)
to authenticated;
