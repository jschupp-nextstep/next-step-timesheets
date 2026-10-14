-- R4: admin flags on entries (Hold / Canceled / Not Next Step) and a
-- question thread between admin and coach.
--
-- A separate column, not new `status` values: status stays strictly about
-- payment (pending/paid), which ~16 RLS policies and most screens rely on.
-- Payable = status 'pending' AND admin_flag IS NULL.
--
-- Deploy order: run this BEFORE pushing the matching code. It's additive for
-- the deployed code, with one visible effect: mark_entries_paid now refuses
-- flagged entries -- and no entry can be flagged until the new UI ships.

alter table timesheet_entries
  add column admin_flag text check (admin_flag in ('hold', 'canceled', 'not_next_step')),
  -- Reason shown to the coach for canceled / not_next_step. (A hold's
  -- question lives in entry_messages instead.)
  add column admin_flag_reason text,
  add column admin_flagged_at timestamptz;

-- 1. Only admins can set or clear a flag. A coach's write to these columns
-- is silently reverted (same approach as admin_entered).
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
    else
      new.admin_flag := old.admin_flag;
      new.admin_flag_reason := old.admin_flag_reason;
      new.admin_flagged_at := old.admin_flagged_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger timesheet_entries_protect_admin_flag
  before insert or update on timesheet_entries
  for each row execute function protect_admin_flag();

-- 2. Coaches can't edit or delete a flagged entry (Justin: reply only).
drop policy "Coaches update own pending timesheet_entries" on timesheet_entries;
create policy "Coaches update own pending timesheet_entries" on timesheet_entries
  for update using (
    coach_id = current_coach_id() and coach_is_active() and status = 'pending'
    and admin_flag is null and coach_date_allowed(entry_date)
  )
  with check (
    coach_id = current_coach_id() and coach_is_active() and status = 'pending'
    and admin_flag is null and coach_date_allowed(entry_date)
  );

drop policy "Coaches delete own pending timesheet_entries" on timesheet_entries;
create policy "Coaches delete own pending timesheet_entries" on timesheet_entries
  for delete using (coach_id = current_coach_id() and status = 'pending' and admin_flag is null);

-- 3. The thread. Append-only; written only through the functions below.
create table entry_messages (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references timesheet_entries (id) on delete cascade,
  author_role text not null check (author_role in ('admin', 'coach')),
  author_user uuid not null,
  author_email text not null,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index entry_messages_entry_idx on entry_messages (entry_id, created_at);

alter table entry_messages enable row level security;
revoke all on entry_messages from anon, authenticated;
grant select on entry_messages to authenticated;

create policy "Admins read entry_messages" on entry_messages
  for select using (is_admin());
create policy "Coaches read own entry_messages" on entry_messages
  for select using (
    exists (select 1 from timesheet_entries e where e.id = entry_id and e.coach_id = current_coach_id())
  );

create or replace function entry_message_post(p_entry_id uuid, p_role text, p_body text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'The message can''t be empty.' using errcode = '22023';
  end if;
  insert into entry_messages (entry_id, author_role, author_user, author_email, body)
    values (p_entry_id, p_role, auth.uid(), lower(auth.jwt() ->> 'email'), btrim(p_body));
end;
$$;

create or replace function entry_assert_admin() returns void
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can do that.' using errcode = '42501';
  end if;
end;
$$;

-- 4. Admin actions.
create or replace function hold_entry(p_entry_id uuid, p_question text) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e timesheet_entries%rowtype;
begin
  perform entry_assert_admin();
  select * into e from timesheet_entries where id = p_entry_id for update;
  if not found then raise exception 'That entry no longer exists.' using errcode = 'P0002'; end if;
  if e.status <> 'pending' then
    raise exception 'Only unpaid entries can be put on hold.' using errcode = '22023';
  end if;
  if e.admin_flag is not null then
    raise exception 'This entry is already flagged (%). Clear that first.', e.admin_flag using errcode = '22023';
  end if;
  perform entry_message_post(p_entry_id, 'admin', p_question);
  update timesheet_entries set admin_flag = 'hold', admin_flag_reason = null, admin_flagged_at = now()
    where id = p_entry_id;
end;
$$;

create or replace function flag_entry(p_entry_id uuid, p_flag text, p_reason text) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e timesheet_entries%rowtype;
begin
  perform entry_assert_admin();
  if p_flag not in ('canceled', 'not_next_step') then
    raise exception 'Unknown flag.' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required -- the coach sees it.' using errcode = '22023';
  end if;
  select * into e from timesheet_entries where id = p_entry_id for update;
  if not found then raise exception 'That entry no longer exists.' using errcode = 'P0002'; end if;
  if e.status <> 'pending' then
    raise exception 'Only unpaid entries can be marked %.', replace(p_flag, '_', ' ') using errcode = '22023';
  end if;
  update timesheet_entries
    set admin_flag = p_flag, admin_flag_reason = btrim(p_reason), admin_flagged_at = now()
    where id = p_entry_id;
end;
$$;

-- Clears any flag; the entry becomes payable again. An optional note is
-- posted to the thread (e.g. "Thanks -- releasing at 1.5 hrs").
create or replace function clear_entry_flag(p_entry_id uuid, p_note text default null) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e timesheet_entries%rowtype;
begin
  perform entry_assert_admin();
  select * into e from timesheet_entries where id = p_entry_id for update;
  if not found then raise exception 'That entry no longer exists.' using errcode = 'P0002'; end if;
  if e.admin_flag is null then
    raise exception 'This entry isn''t flagged.' using errcode = '22023';
  end if;
  if p_note is not null and length(btrim(p_note)) > 0 then
    perform entry_message_post(p_entry_id, 'admin', p_note);
  end if;
  update timesheet_entries set admin_flag = null, admin_flag_reason = null, admin_flagged_at = null
    where id = p_entry_id;
end;
$$;

create or replace function admin_entry_message(p_entry_id uuid, p_body text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform entry_assert_admin();
  if not exists (select 1 from timesheet_entries where id = p_entry_id) then
    raise exception 'That entry no longer exists.' using errcode = 'P0002';
  end if;
  perform entry_message_post(p_entry_id, 'admin', p_body);
end;
$$;

-- 5. Coach reply: own entry, and only while it's on hold.
create or replace function coach_reply_entry(p_entry_id uuid, p_body text) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e timesheet_entries%rowtype;
begin
  if current_coach_id() is null then
    raise exception 'Not allowed: only the coach on this entry can reply.' using errcode = '42501';
  end if;
  select * into e from timesheet_entries where id = p_entry_id;
  if not found or e.coach_id <> current_coach_id() then
    raise exception 'Not allowed: only the coach on this entry can reply.' using errcode = '42501';
  end if;
  if e.admin_flag is distinct from 'hold' then
    raise exception 'This entry isn''t waiting on an answer any more.' using errcode = '22023';
  end if;
  perform entry_message_post(p_entry_id, 'coach', p_body);
end;
$$;

-- 6. Mark all paid must never pay a flagged entry. Same as 0024, plus the
-- admin_flag check.
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
      );
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception '% of % entries could not be marked paid (no longer pending, on hold or excluded, outside the range, or held for schedule review). Nothing was changed.',
      v_expected - v_updated, v_expected using errcode = '22023';
  end if;
  return v_updated;
end;
$$;

revoke execute on function
  protect_admin_flag(), entry_message_post(uuid, text, text), entry_assert_admin(),
  hold_entry(uuid, text), flag_entry(uuid, text, text), clear_entry_flag(uuid, text),
  admin_entry_message(uuid, text), coach_reply_entry(uuid, text)
from public, anon;
grant execute on function
  hold_entry(uuid, text), flag_entry(uuid, text, text), clear_entry_flag(uuid, text),
  admin_entry_message(uuid, text), coach_reply_entry(uuid, text)
to authenticated;
