-- Staff type on the roster (Justin, 2026-11-01): coach / nurse / operations,
-- for sorting and filtering people. Purely descriptive -- pay still comes
-- from rates, and sign-in/permissions from the role tables.
--
-- Additive: new column with a default, so the deployed code keeps working.
-- Run before pushing the code that writes it (the Add coach form sends it).

alter table coaches
  add column if not exists staff_type text not null default 'coach'
  check (staff_type in ('coach', 'nurse', 'operations'));

-- Starting point: anyone whose rates are only Nurse rates (plus
-- Set-up/Break-down, which nurses also get) is a nurse. Everyone else stays
-- 'coach'; set Operations by hand.
update coaches c
set staff_type = 'nurse'
where exists (
    select 1 from rates r join programs p on p.id = r.program_id
    where r.coach_id = c.id and p.name like 'Nurse-%'
  )
  and not exists (
    select 1 from rates r join programs p on p.id = r.program_id
    where r.coach_id = c.id and p.name not like 'Nurse-%' and p.name <> 'Set-up/Break-down'
  );


-- Schedulers see names through coach_directory (0018), so it carries the
-- staff type too, for grouping the coach pickers. New column goes last
-- (create or replace view can only add at the end); same owner, grants, and
-- WHERE as before.
create or replace view coach_directory as
  select id, name, initials, is_active, staff_type
  from coaches
  where is_admin() or current_scheduler_id() is not null or id = current_coach_id();

select name, staff_type from coaches where staff_type <> 'coach' order by name;
