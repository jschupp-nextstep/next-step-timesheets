-- Admin-managed reference table for pay periods. Hand-correctable, not
-- computed from a fixed cadence -- the coach-facing "band" logic (see
-- src/utils/payPeriods.ts) counts back by ROW ORDER (start_date ascending),
-- not by elapsed days, so editing dates here doesn't silently reshuffle
-- which events are in which band relative to a hardcoded interval.
create table pay_periods (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  constraint pay_periods_end_after_start check (end_date >= start_date)
);

alter table pay_periods enable row level security;
grant select, insert, update, delete on pay_periods to authenticated;

-- Coaches need read access: the band math in the coach-facing log-session
-- picker runs client-side and needs the full period list, same as programs/
-- locations/events being readable by "anyone authenticated" today.
create policy "Anyone authenticated can read pay_periods" on pay_periods
  for select using (auth.role() = 'authenticated');
create policy "Admins insert pay_periods" on pay_periods
  for insert with check (is_admin());
create policy "Admins update pay_periods" on pay_periods
  for update using (is_admin()) with check (is_admin());
create policy "Admins delete pay_periods" on pay_periods
  for delete using (is_admin());
