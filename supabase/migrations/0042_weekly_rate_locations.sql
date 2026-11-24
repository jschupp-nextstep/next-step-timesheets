-- Weekly rates can be limited to a location (Justin, 2026-11-24): Prince's
-- $1,100 covers Town Session at Dedham/Quincy, not a Town Session he fills in
-- for elsewhere -- that one stays hourly.
--
-- weekly_rates.location_id: null = any location (as before). A rate then
-- covers an entry when coach, dates, program (if set) and location (if set)
-- all match; the most specific matching rate wins (src/utility/weeklyPay.ts).
-- Attaching sessions to a paid week checks the location too.
--
-- Additive: existing rates keep location_id null and behave as before.

alter table weekly_rates add column if not exists location_id uuid references locations (id);

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
      and (r.location_id is null or e.location_id = r.location_id)
      and e.status = 'pending'
      and e.admin_flag is null;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception '% of % sessions couldn''t be included (not this coach''s, outside the week or the rate''s program/location, already paid, or flagged). Nothing was changed.',
      v_expected - v_updated, v_expected using errcode = '22023';
  end if;
  return v_updated;
end;
$$;
