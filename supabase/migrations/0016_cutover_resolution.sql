-- Follow-up to 0015, per Justin's review of the cutover plan:
--
-- 1. admin_entered is provenance -- a fact about who created the row -- so
--    it's set on insert and immutable afterward, for admins too. 0015 let an
--    admin flip it on update (the cleanup card's "Pay in app"), which mixed
--    "who entered this" with "what did we decide about it."
-- 2. That decision gets its own column instead. A pre-cutover pending entry
--    is either "paid_in_sheets" (a distinct marker, not just a normal paid
--    status -- it was never paid through this app) or "still_owed" (Sheets
--    never paid it; payable here like an admin-entered entry). Some September
--    sessions genuinely were never paid in Sheets.

alter table timesheet_entries add column cutover_resolution text
  check (cutover_resolution in ('paid_in_sheets', 'still_owed'));

create or replace function set_timesheet_entry_admin_entered() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.admin_entered := is_admin();
    if not is_admin() then
      new.cutover_resolution := null;
    end if;
  else
    new.admin_entered := old.admin_entered;
    if not is_admin() then
      new.cutover_resolution := old.cutover_resolution;
    end if;
  end if;

  if new.cutover_resolution is distinct from (case when tg_op = 'UPDATE' then old.cutover_resolution end) then
    -- Only ever a decision about a pre-cutover entry -- the cleanup card
    -- must never be able to touch a post-cutover one, even by mistake.
    if new.cutover_resolution is not null
      and (cutover_date() is null or new.entry_date >= cutover_date()) then
      raise exception 'cutover_resolution can only be set on entries dated before the cutover date';
    end if;
    -- Keep status consistent so every existing "already paid" check (Band A
    -- picker, coach edit lockout, Payment Due's pending list) treats it as
    -- paid without needing to know about this column.
    if new.cutover_resolution = 'paid_in_sheets' then
      new.status := 'paid';
      new.paid_date := null;
    end if;
  end if;

  return new;
end;
$$;
