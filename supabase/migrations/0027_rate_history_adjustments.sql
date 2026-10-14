-- R8 (rest): rate effective dates + dollar adjustments.
--
-- Run together with the matching push (see "Migration ↔ deploy rule"):
-- dropping the one-rate-per-coach-and-program constraint is harmless to the
-- deployed code until someone actually uses "Change rate…", which only the
-- new code offers.

-- 1. Rates get effective dates. Existing rates apply "since the beginning"
-- (effective_from null) and are ongoing (effective_to null), so nothing
-- prices differently today.
alter table rates
  add column effective_from date,
  add column effective_to date,
  add constraint rates_effective_dates check (effective_to is null or effective_from is null or effective_to >= effective_from);

-- A coach+program may now have several rate rows over time, just never two
-- active ones covering the same day.
alter table rates drop constraint rates_coach_id_program_id_key;

create or replace function rates_no_overlap() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active and exists (
    select 1 from rates r
    where r.id <> new.id and r.is_active
      and r.coach_id = new.coach_id and r.program_id = new.program_id
      and coalesce(r.effective_from, '-infinity'::date) <= coalesce(new.effective_to, 'infinity'::date)
      and coalesce(new.effective_from, '-infinity'::date) <= coalesce(r.effective_to, 'infinity'::date)
  ) then
    raise exception 'This coach already has an active rate for this program covering some of those dates. End that rate first (or use "Change rate…").'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger rates_no_overlap
  before insert or update on rates
  for each row execute function rates_no_overlap();

-- "Change rate from a date": close the current row the day before and start
-- a new one. Entries before the date keep the old rate; paid entries never
-- change (0024 saved their amounts).
create or replace function change_rate(p_rate_id uuid, p_new_rate numeric, p_from date) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  r rates%rowtype;
  v_new uuid;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can change rates.' using errcode = '42501';
  end if;
  select * into r from rates where id = p_rate_id for update;
  if not found then raise exception 'That rate no longer exists.' using errcode = 'P0002'; end if;
  if p_new_rate is null or p_new_rate < 0 then
    raise exception 'Enter the new hourly rate.' using errcode = '22023';
  end if;
  if p_from is null then
    raise exception 'Enter the date the new rate starts.' using errcode = '22023';
  end if;
  if r.effective_from is not null and p_from <= r.effective_from then
    raise exception 'The new rate has to start after the current one did (%).', r.effective_from using errcode = '22023';
  end if;
  if r.effective_to is not null then
    raise exception 'This rate has already ended; change the current one instead.' using errcode = '22023';
  end if;

  update rates set effective_to = p_from - 1 where id = r.id;
  insert into rates (coach_id, program_id, hourly_rate, is_active, effective_from)
    values (r.coach_id, r.program_id, p_new_rate, true, p_from)
    returning id into v_new;
  return v_new;
end;
$$;

revoke execute on function change_rate(uuid, numeric, date), rates_no_overlap() from public, anon;
grant execute on function change_rate(uuid, numeric, date) to authenticated;

-- 2. Dollar adjustments (rate-correction catch-ups, weekly top-ups): an
-- admin-only program, entered from Payment Due as a flat-amount entry with
-- a required reason. Flat amounts already flow through Payment Due, Mark
-- all paid (basis 'flat') and the Zoho export.
insert into programs (name, code, entry_mode)
select 'Adjustment', 'ADJ', 'admin_only'
where not exists (select 1 from programs where name = 'Adjustment');
