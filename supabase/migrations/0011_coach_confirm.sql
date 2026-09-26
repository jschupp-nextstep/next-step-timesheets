-- Coach tap-to-confirm ("I'll be there") on /my-sessions. Column-scoped grant
-- so a coach's update can only ever touch coach_confirmed_at on their own
-- row -- not event_id/coach_id/program_id via a raw REST call. Note: this
-- also caps admin UPDATEs on event_assignments to this one column, since
-- admin and coach both hit Postgres as the same `authenticated` role (RLS
-- filters rows, not columns). Nothing in the app currently UPDATEs this
-- table (the Schedule Board's coach picker does delete+insert), so this is
-- safe today -- a future admin feature that needs to update other columns
-- here directly will need its own path (e.g. a security-definer function).
alter table event_assignments add column coach_confirmed_at timestamptz;

revoke update on event_assignments from authenticated;
grant update (coach_confirmed_at) on event_assignments to authenticated;

create policy "Coaches confirm own event_assignments" on event_assignments
  for update using (coach_id = current_coach_id()) with check (coach_id = current_coach_id());
