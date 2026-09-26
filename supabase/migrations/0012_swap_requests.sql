-- Coach-initiated, admin-approved swap requests. Unlike oversight_approvals
-- (insert-only, "pending" just means no row exists yet), this needs a real
-- live pending state: a coach creates the request before any decision
-- exists, and both the coach and an admin need to see it sitting there.
create table swap_requests (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches (id),
  event_id uuid not null references events (id),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  -- Bare uuid, no FK -- there is no admins table in this schema; "admin" is
  -- purely "an authenticated user whose email doesn't match any
  -- coaches.email," per is_admin().
  reviewed_by uuid,
  reviewed_at timestamptz
);

-- Blocks duplicate simultaneous pending requests for the same event/coach
-- without blocking a later re-request after denial (unlike
-- oversight_approvals.source_entry_id's plain unique constraint, which
-- suits a one-time irreversible decision, not this).
create unique index swap_requests_one_pending_per_event_coach
  on swap_requests (event_id, coach_id) where status = 'pending';

alter table swap_requests enable row level security;
grant select, insert, update, delete on swap_requests to authenticated;

create policy "Coaches insert own swap_requests" on swap_requests
  for insert with check (coach_id = current_coach_id());
create policy "Coaches select own swap_requests" on swap_requests
  for select using (coach_id = current_coach_id());
create policy "Admins manage swap_requests" on swap_requests
  for all using (is_admin()) with check (is_admin());
