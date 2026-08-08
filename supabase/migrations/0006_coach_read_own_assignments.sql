-- My Sessions needs a coach to see which events they're actually assigned
-- to (so "assigned but not yet logged" can be computed), but the only
-- event_assignments policy so far is admin-only. Add a narrow, read-only
-- self-access policy -- a coach still can't see anyone else's assignments,
-- and still can't write to this table at all (that stays admin/import-only).
create policy "Coaches select own event_assignments" on event_assignments
  for select using (coach_id = current_coach_id());
