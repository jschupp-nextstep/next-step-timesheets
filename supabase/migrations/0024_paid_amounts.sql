-- R8 (minimal): save what each entry was actually paid, when it's paid.
--
-- Until now an entry stored only status/paid_date, and paid history was
-- recomputed from *current* rates -- so changing a coach's rate silently
-- rewrote what their already-paid entries showed. From here on the rate,
-- amount, and how the amount was arrived at are fixed on the entry at the
-- moment it's marked paid.
--
-- Additive, but run it BEFORE pushing the matching code: the new Payment
-- Due calls mark_entries_paid(). The deployed code marks entries paid by a
-- plain update, which the trigger below would now refuse (no amount) -- so
-- don't run a payroll in the gap between this migration and the push.

alter table timesheet_entries
  add column paid_rate numeric(8, 2),
  add column paid_amount numeric(10, 2),
  add column paid_rate_basis text
    check (paid_rate_basis in ('exact', 'coaching_fallback', 'flat', 'one_v_one', 'manual'));

-- 1. Paid always carries an amount. The one exception is "Paid in Sheets"
-- (cutover_resolution, 0016): paid in the old system, amount unknown here.
-- Entries already paid before this migration have no amount and aren't
-- touched; they just can't have an amount *removed* once one is recorded.
create or replace function require_paid_amount() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'paid'
     and new.paid_amount is null
     and new.cutover_resolution is distinct from 'paid_in_sheets'
     and (tg_op = 'INSERT' or old.status <> 'paid' or old.paid_amount is not null) then
    raise exception 'An entry can only be marked paid with the amount it was paid.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Named to sort before timesheet_entries_set_admin_entered: that trigger
-- forces status = 'paid' for paid_in_sheets, which this one exempts anyway.
create trigger timesheet_entries_require_paid_amount
  before insert or update on timesheet_entries
  for each row execute function require_paid_amount();

-- 2. The one way Payment Due marks entries paid. All-or-nothing: every row
-- must still be pending, inside the payroll range, not held for schedule
-- review (R2c), and carry an amount -- otherwise nothing is changed and the
-- reason is reported. Amounts come from the client's computeAmount (the
-- same numbers Payment Due shows), passed as
-- [{"id": ..., "paid_rate": ..., "paid_amount": ..., "paid_rate_basis": ...}].
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
      and e.entry_date between p_range_start and p_range_end
      and not exists (
        select 1 from schedule_changes c where c.event_id = e.event_id and c.review_status = 'needs_review'
      );
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception '% of % entries could not be marked paid (no longer pending, outside the range, or held for schedule review). Nothing was changed.',
      v_expected - v_updated, v_expected using errcode = '22023';
  end if;
  return v_updated;
end;
$$;

revoke execute on function mark_entries_paid(jsonb, date, date, date), require_paid_amount() from public, anon;
grant execute on function mark_entries_paid(jsonb, date, date, date) to authenticated;
