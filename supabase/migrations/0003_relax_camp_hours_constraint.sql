-- Real data has camp/nurse locations with legitimately unknown hours (e.g. "TBD"
-- while a site's schedule is still being finalized), so half/full day hours
-- can't be required at the database level -- the admin UI already marks them
-- as required in the form for the common case, but the DB shouldn't reject a
-- real "we don't know yet" location.

alter table locations drop constraint camp_nurse_hours_required;
