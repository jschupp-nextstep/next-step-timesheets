-- One claims queue, four claim types. Like swap_requests (not
-- oversight_approvals): a real live 'pending' row both the coach and an
-- admin need to see before any decision exists.
create table payment_claims (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches (id),
  claim_type text not null check (
    claim_type in ('late_event', 'unassigned_claim', 'unstructured', 'hours_correction')
  ),
  event_id uuid references events (id),
  -- Needed so an approved hours_correction claim updates the EXACT
  -- timesheet_entries row it's correcting, rather than re-deriving it from
  -- (coach_id, event_id) at review time, which is ambiguous if the coach
  -- deletes/re-logs between request and review. Null except for
  -- hours_correction claims requested after the entry already exists.
  entry_id uuid references timesheet_entries (id),
  program_id uuid not null references programs (id),
  location_id uuid not null references locations (id),
  approx_date date,
  scheduled_hours numeric(5, 2),
  requested_hours numeric(5, 2),
  reason text,
  -- Band C's structured form needs a fixed reason-category dropdown AND
  -- free-text elaboration -- `reason` holds the category (or free text for
  -- the other three claim types), `notes` holds the elaboration, populated
  -- only for 'unstructured'.
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  -- Bare uuid, no FK -- there is no admins table in this schema; "admin" is
  -- purely "an authenticated user whose email doesn't match any
  -- coaches.email," per is_admin(). Same reasoning as swap_requests.reviewed_by.
  reviewed_by uuid,
  reviewed_at timestamptz,

  constraint payment_claims_event_id_matches_type check (
    (claim_type = 'unstructured' and event_id is null)
    or (claim_type <> 'unstructured' and event_id is not null)
  ),
  constraint payment_claims_approx_date_only_unstructured check (
    claim_type = 'unstructured' or approx_date is null
  ),
  constraint payment_claims_hours_only_correction check (
    (claim_type = 'hours_correction' and scheduled_hours is not null and requested_hours is not null)
    or (claim_type <> 'hours_correction' and scheduled_hours is null and requested_hours is null)
  ),
  constraint payment_claims_entry_id_only_correction check (
    claim_type = 'hours_correction' or entry_id is null
  )
);

create index payment_claims_status_idx on payment_claims (status, requested_at);

alter table payment_claims enable row level security;
grant select, insert, update, delete on payment_claims to authenticated;

create policy "Coaches insert own payment_claims" on payment_claims
  for insert with check (coach_id = current_coach_id());
create policy "Coaches select own payment_claims" on payment_claims
  for select using (coach_id = current_coach_id());
create policy "Admins manage payment_claims" on payment_claims
  for all using (is_admin()) with check (is_admin());

-- Partial unique indexes, decided per claim_type (not copy-pasted from
-- swap_requests): late_event and unassigned_claim use (event_id, coach_id)
-- like swap_requests, kept as separate indexes since a coach could
-- legitimately have one pending claim of each type on the same event at
-- once -- different intents, no reason to conflate them. hours_correction
-- keys off whichever of entry_id/event_id exists (a claim always has
-- event_id set, but entry_id is the more precise key once it exists).
-- unstructured gets NO uniqueness constraint -- event_id is null by
-- definition and there's no real natural key; duplicate-looking claims are
-- an admin judgment call at review time.
create unique index payment_claims_one_pending_late_event
  on payment_claims (event_id, coach_id) where status = 'pending' and claim_type = 'late_event';
create unique index payment_claims_one_pending_unassigned_claim
  on payment_claims (event_id, coach_id) where status = 'pending' and claim_type = 'unassigned_claim';
create unique index payment_claims_one_pending_hours_correction
  on payment_claims (coalesce(entry_id, event_id), coach_id)
  where status = 'pending' and claim_type = 'hours_correction';
