-- R7: weekly-rate coaches (Prince $1,100/week Sat–Fri, Hayley $200/week
-- Mon–Sun). Their sessions are logged as usual; Payment Due shows one line
-- per coach-week instead of hours, and paying a week records the money on a
-- weekly_payments row and marks that week's entries paid with basis 'weekly'
-- and amount $0 (the money is on the week, not split across sessions --
-- keeps 0024's "paid always carries an amount" rule honest).
--
-- Additive. Run BEFORE pushing the matching code (the new Payment Due reads
-- weekly_rates/weekly_payments); the deployed code ignores both.

create table weekly_rates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches (id),
  -- null = all of the coach's work; otherwise only this program (anything
  -- else stays hourly). Justin, 2026-10-14: chosen per rate.
  program_id uuid references programs (id),
  weekly_amount numeric(10, 2) not null check (weekly_amount > 0),
  -- 0 = Sunday ... 6 = Saturday.
  week_start_dow int not null check (week_start_dow between 0 and 6),
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  constraint weekly_rates_dates check (effective_to is null or effective_to >= effective_from)
);

create table weekly_payments (
  id uuid primary key default gen_random_uuid(),
  weekly_rate_id uuid not null references weekly_rates (id),
  coach_id uuid not null references coaches (id),
  week_start date not null,
  week_end date not null,
  amount numeric(10, 2) not null check (amount >= 0),
  -- The rate's amount at the time; a different `amount` needs a note.
  standard_amount numeric(10, 2) not null,
  note text,
  paid_date date not null,
  paid_by uuid not null,
  created_at timestamptz not null default now(),
  unique (weekly_rate_id, week_start)
);

alter table timesheet_entries add column weekly_payment_id uuid references weekly_payments (id);

alter table timesheet_entries drop constraint timesheet_entries_paid_rate_basis_check;
alter table timesheet_entries add constraint timesheet_entries_paid_rate_basis_check
  check (paid_rate_basis in ('exact', 'coaching_fallback', 'flat', 'one_v_one', 'manual', 'weekly'));

alter table weekly_rates enable row level security;
alter table weekly_payments enable row level security;
revoke all on weekly_rates, weekly_payments from anon, authenticated;
grant select, insert, update, delete on weekly_rates to authenticated;
grant select on weekly_payments to authenticated;

create policy "Admins manage weekly_rates" on weekly_rates
  for all using (is_admin()) with check (is_admin());
create policy "Admins read weekly_payments" on weekly_payments
  for select using (is_admin());
-- A coach sees their own weekly payments (Justin: coaches see what they
-- were paid), so Paid history can show "Weekly pay" rather than $0 lines.
create policy "Coaches read own weekly_payments" on weekly_payments
  for select using (coach_id = current_coach_id());

-- Pay one coach-week: record the payment and mark the given entries paid
-- (basis 'weekly', amount 0, linked to the payment). Also used to pay a week
-- in advance (no entries yet). All-or-nothing: every entry must be this
-- coach's, inside the week, covered by the rate's program scope, pending,
-- and unflagged.
create or replace function pay_weekly(
  p_weekly_rate_id uuid, p_week_start date, p_amount numeric, p_note text, p_entry_ids uuid[], p_paid_date date
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  r weekly_rates%rowtype;
  v_week_end date := p_week_start + 6;
  v_payment uuid;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can pay a week.' using errcode = '42501';
  end if;
  select * into r from weekly_rates where id = p_weekly_rate_id;
  if not found then raise exception 'That weekly rate no longer exists.' using errcode = 'P0002'; end if;
  if extract(dow from p_week_start)::int <> r.week_start_dow then
    raise exception 'That date isn''t the first day of this coach''s week.' using errcode = '22023';
  end if;
  if v_week_end < r.effective_from or (r.effective_to is not null and p_week_start > r.effective_to) then
    raise exception 'The weekly rate isn''t in effect for that week.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Enter the amount paid for the week.' using errcode = '22023';
  end if;
  if p_amount <> r.weekly_amount and (p_note is null or length(btrim(p_note)) = 0) then
    raise exception 'The amount differs from the weekly rate ($%), so a note is required.', r.weekly_amount using errcode = '22023';
  end if;

  insert into weekly_payments (weekly_rate_id, coach_id, week_start, week_end, amount, standard_amount, note, paid_date, paid_by)
    values (r.id, r.coach_id, p_week_start, v_week_end, p_amount, r.weekly_amount, nullif(btrim(p_note), ''), p_paid_date, auth.uid())
    returning id into v_payment;

  perform attach_weekly_entries_internal(v_payment, p_entry_ids);
  return v_payment;
exception
  when unique_violation then
    raise exception 'This week has already been paid.' using errcode = '23505';
end;
$$;

-- Link entries logged after their week was paid (e.g. paid in advance).
create or replace function attach_weekly_entries(p_payment_id uuid, p_entry_ids uuid[]) returns int
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can do that.' using errcode = '42501';
  end if;
  return attach_weekly_entries_internal(p_payment_id, p_entry_ids);
end;
$$;

create or replace function attach_weekly_entries_internal(p_payment_id uuid, p_entry_ids uuid[]) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  p weekly_payments%rowtype;
  r weekly_rates%rowtype;
  v_expected int := coalesce(array_length(p_entry_ids, 1), 0);
  v_updated int;
begin
  if v_expected = 0 then return 0; end if;
  select * into p from weekly_payments where id = p_payment_id;
  select * into r from weekly_rates where id = p.weekly_rate_id;

  update timesheet_entries e
    set status = 'paid', paid_date = p.paid_date, paid_rate = null, paid_amount = 0,
        paid_rate_basis = 'weekly', weekly_payment_id = p.id
    where e.id = any(p_entry_ids)
      and e.coach_id = p.coach_id
      and e.entry_date between p.week_start and p.week_end
      and (r.program_id is null or e.program_id = r.program_id)
      and e.status = 'pending'
      and e.admin_flag is null;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception '% of % sessions couldn''t be included (not this coach''s, outside the week or the rate''s program, already paid, or flagged). Nothing was changed.',
      v_expected - v_updated, v_expected using errcode = '22023';
  end if;
  return v_updated;
end;
$$;

revoke execute on function
  pay_weekly(uuid, date, numeric, text, uuid[], date), attach_weekly_entries(uuid, uuid[]),
  attach_weekly_entries_internal(uuid, uuid[])
from public, anon;
grant execute on function pay_weekly(uuid, date, numeric, text, uuid[], date), attach_weekly_entries(uuid, uuid[])
  to authenticated;
