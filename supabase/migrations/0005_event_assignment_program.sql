-- Lets the Sprocket importer (and admin, later) note which specific
-- program/rate category an assigned coach worked an event under -- e.g.
-- distinguishing a Nurse from a Counselor at the same Camp session, which
-- Sprocket doesn't always capture on its own. Null means "just confirms
-- assignment, no specific program noted."
alter table event_assignments add column program_id uuid references programs (id);
