-- Phase 3: payroll views. Flat-fee entries (1v1 session fee, and approved
-- oversight-fee entries) capture their dollar amount at creation time
-- rather than recomputing it from current rates whenever the Payment Due
-- report loads -- correct even if a coach's rate changes later, and
-- necessary at all for oversight fees, which are never the earner's own
-- rate to begin with (they're the *other* coach's rate). Hourly entries
-- keep working the old way: hours x current rate, computed at report time.
alter table timesheet_entries add column flat_amount numeric(8, 2);

-- Not every 1v1 session with an oversight coach on file necessarily had
-- oversight actually happen -- a reconciler has to confirm it per entry,
-- not have it silently assumed from the rate configuration. One decision
-- per original entry; approving creates a real payable entry for the
-- oversight coach (oversight_entry_id), so they see it in their own My
-- Sessions/Payment Due like any other entry rather than it being some
-- invisible side calculation.
create table oversight_approvals (
  id uuid primary key default gen_random_uuid(),
  source_entry_id uuid not null references timesheet_entries (id) unique,
  decision text not null check (decision in ('approved', 'declined')),
  oversight_entry_id uuid references timesheet_entries (id),
  decided_at timestamptz not null default now()
);

alter table oversight_approvals enable row level security;
grant select, insert, update, delete on oversight_approvals to authenticated;

create policy "Admins manage oversight_approvals" on oversight_approvals
  for all using (is_admin()) with check (is_admin());
