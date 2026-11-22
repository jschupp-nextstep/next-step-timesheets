-- Phase 9 step 1b: the Sprocket event fields a session needs so the app can
-- write it out as a Sprocket row (export) -- until now only kept in the raw
-- imported rows.
--
--   event_type      practice / game / club / other (Sprocket ClubEventType);
--                   null = not known (sessions created before this, July
--                   imports) -- treated as practice when exported.
--   opponent, away_game, uniform, is_private
--   arrival_minutes how many minutes before the start players/coaches
--                   arrive. NOT paid time: that stays paid_early_minutes
--                   (Town arrives 15 early but is paid from the start).
--
-- Filled from each imported event's first raw row below; from now on 0035's
-- trigger fills them for newly imported sessions (blanks only -- never
-- overwrites a value set here).
--
-- Deferred to later Phase 9 steps: deleted_at (soft delete, for DeleteEvent
-- -- step 7) and event_series (weekday series -- step 2).
--
-- Additive only.

alter table events
  add column if not exists event_type text check (event_type in ('practice', 'game', 'club', 'other')),
  add column if not exists opponent text,
  add column if not exists away_game boolean not null default false,
  add column if not exists uniform text,
  add column if not exists is_private boolean not null default false,
  add column if not exists arrival_minutes int check (arrival_minutes is null or arrival_minutes between 1 and 240);

-- "03:45 PM" -> time, or null if blank/unreadable.
create or replace function sprocket_time(p text) returns time
language sql stable
as $$
  select case when trim(coalesce(p, '')) ~* '^\d{1,2}:\d{2}\s*[ap]m$'
    then trim(p)::time end;
$$;

-- Minutes between Sprocket's ArrivalTime and the session start, when it's
-- actually earlier (and under 4 hours).
create or replace function sprocket_arrival_minutes(p_arrival text, p_start time) returns int
language sql stable
as $$
  select case when m between 1 and 240 then m end
  from (select (extract(epoch from (p_start - sprocket_time(p_arrival))) / 60)::int as m) x;
$$;

revoke execute on function sprocket_time(text), sprocket_arrival_minutes(text, time) from public, anon;
grant execute on function sprocket_time(text), sprocket_arrival_minutes(text, time) to authenticated;

update events e set
  event_type = case lower(trim(r ->> 'ClubEventType'))
    when 'practice' then 'practice' when 'game' then 'game' when 'club' then 'club' when 'other' then 'other' end,
  opponent = nullif(trim(r ->> 'Opponent'), ''),
  away_game = lower(trim(coalesce(r ->> 'AwayGame', ''))) = 'yes',
  uniform = nullif(trim(r ->> 'Uniform'), ''),
  is_private = lower(trim(coalesce(r ->> 'IsPrivate', ''))) = 'yes',
  arrival_minutes = sprocket_arrival_minutes(r ->> 'ArrivalTime', e.start_time)
from (select id, sprocket_rows -> 0 as r from events where jsonb_typeof(sprocket_rows) = 'array') x
where e.id = x.id and e.event_type is null;

select event_type, count(*), count(arrival_minutes) as with_arrival, count(opponent) as with_opponent
from events group by event_type order by event_type;
