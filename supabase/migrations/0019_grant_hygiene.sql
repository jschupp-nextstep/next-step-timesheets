-- From the 2026-10-12 live audit: `authenticated` holds TRUNCATE, TRIGGER,
-- and REFERENCES on every public table (and the coach_directory view).
-- TRUNCATE in particular bypasses RLS entirely. None of the three is
-- reachable through the REST API today (PostgREST never issues them), so
-- this isn't an open hole -- but nothing in the app needs them, and they'd
-- become one the moment any function or new access path did. The
-- SELECT/INSERT/UPDATE/DELETE grants stay; RLS remains what limits those.
revoke truncate, trigger, references on all tables in schema public from authenticated;
