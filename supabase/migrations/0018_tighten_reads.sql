-- Close Phase 2's blanket reads before schedulers get write access (R2b).
--
-- 0004 made coaches/programs/locations/events readable by *any* signed-in
-- user, and 0013/0015 copied that for pay_periods/app_settings. For coaches
-- that meant every coach and scheduler could read every coach's email and
-- pay_type. Fixed here:
--   * coaches: admins read all rows; a coach reads only their own.
--   * coach_directory: a names-only view for the non-admin screens that
--     need other coaches' names (schedulers). A coach sees only themselves.
--   * Reference tables: readable by anyone with an app role (admin,
--     scheduler, coach) -- not just "signed in", which since 0017 also
--     includes logins that are on no roster at all.
--   * anon (not signed in) gets nothing from any of this.

-- 1. "Has some role in this app." Used in place of auth.role() = 'authenticated'.
create or replace function has_app_role() returns boolean
language sql stable security definer
set search_path = public
as $$
  select is_admin() or current_scheduler_id() is not null or current_coach_id() is not null;
$$;

-- 2. coaches: no more blanket read.
drop policy "Anyone authenticated can read coaches" on coaches;
create policy "Admins read coaches" on coaches
  for select using (is_admin());
create policy "Coaches read own coach row" on coaches
  for select using (id = current_coach_id());

-- Owned by the migration role and NOT security_invoker, so it reads coaches
-- past the policies above -- deliberately; its own WHERE does the
-- restricting. Supabase's Security Advisor flags this as a "security
-- definer view"; that's expected here.
create view coach_directory as
  select id, name, initials, is_active
  from coaches
  where is_admin() or current_scheduler_id() is not null or id = current_coach_id();

revoke all on coach_directory from anon, public;
grant select on coach_directory to authenticated;

-- 3. Reference tables: "anyone authenticated" -> "anyone with an app role".
drop policy "Anyone authenticated can read programs" on programs;
create policy "App users read programs" on programs for select using (has_app_role());

drop policy "Anyone authenticated can read locations" on locations;
create policy "App users read locations" on locations for select using (has_app_role());

drop policy "Anyone authenticated can read events" on events;
create policy "App users read events" on events for select using (has_app_role());

drop policy "Anyone authenticated can read pay_periods" on pay_periods;
create policy "App users read pay_periods" on pay_periods for select using (has_app_role());

drop policy "Anyone authenticated can read app_settings" on app_settings;
create policy "App users read app_settings" on app_settings for select using (has_app_role());

-- 4. anon: defense in depth. Every policy above already evaluates false for
-- anon (no JWT email -> no role), but nothing in this app reads a table
-- before sign-in, so anon shouldn't hold table privileges at all.
revoke all on all tables in schema public from anon;

-- Our own functions: callable by signed-in users only. (Postgres grants
-- EXECUTE to PUBLIC by default, which anon inherits.) Named explicitly
-- rather than "all functions in schema public" so nothing Supabase or an
-- extension put in public is touched.
revoke execute on function
  current_coach_id(), is_admin(), cutover_date(), coach_date_allowed(date),
  claim_date(uuid, date), current_scheduler_id(), is_scheduler_for_event(uuid),
  is_scheduler_for_program_location(uuid, uuid), in_my_scope(events), has_app_role()
from public, anon;
grant execute on function
  current_coach_id(), is_admin(), cutover_date(), coach_date_allowed(date),
  claim_date(uuid, date), current_scheduler_id(), is_scheduler_for_event(uuid),
  is_scheduler_for_program_location(uuid, uuid), in_my_scope(events), has_app_role()
to authenticated;
