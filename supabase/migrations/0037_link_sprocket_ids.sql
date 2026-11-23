-- Phase 9 step 4: link Sprocket's IDs back to sessions made in this app.
--
-- After an export (step 3) is uploaded, Sprocket gives every new row an ID.
-- sprocket_link_rows saves each one on its event_sprocket_rows row (state
-- new -> linked) and on the event's sprocket_event_ids / sprocket_rows, so
--   * a later export can update the row by ID instead of creating it again;
--   * the Sprocket importer recognises the session instead of duplicating it.
--
-- events.app_managed: set on every session linked this way. The importer
-- never applies Sprocket's changes to such a session (it's scheduled here;
-- Sprocket is downstream) -- it only reports them. Imported sessions keep
-- syncing as before until the switch.
--
-- Also adds the three winter locations from Sprocket's winter calendar
-- (Justin's export, 2026-11-22) with their Sprocket IDs, so the winter
-- import maps them automatically.
--
-- Additive: new column (default false), new function, new location rows.

alter table events add column if not exists app_managed boolean not null default false;

-- p_links: [{row_id uuid, club_calendar_event_id text, sprocket_row jsonb}]
create or replace function sprocket_link_rows(p_links jsonb) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  l record;
  r event_sprocket_rows%rowtype;
  v_events uuid[] := '{}';
  v_event uuid;
  v_count int := 0;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can link Sprocket IDs.' using errcode = '42501';
  end if;

  for l in select * from jsonb_to_recordset(coalesce(p_links, '[]'))
             as x(row_id uuid, club_calendar_event_id text, sprocket_row jsonb) loop
    if nullif(btrim(coalesce(l.club_calendar_event_id, '')), '') is null then
      raise exception 'A Sprocket row has no ClubCalendarEventID.' using errcode = '22023';
    end if;
    select * into r from event_sprocket_rows where id = l.row_id for update;
    if not found then
      raise exception 'A session row to link no longer exists -- upload the file again.' using errcode = 'P0002';
    end if;
    if r.state <> 'new' then
      raise exception 'A session row is already linked -- upload the file again.' using errcode = '22023';
    end if;
    if exists (select 1 from event_sprocket_rows where club_calendar_event_id = btrim(l.club_calendar_event_id))
       or exists (select 1 from events where btrim(l.club_calendar_event_id) = any (sprocket_event_ids)) then
      raise exception 'Sprocket event % is already linked to a session.', btrim(l.club_calendar_event_id) using errcode = '22023';
    end if;

    update event_sprocket_rows
      set club_calendar_event_id = btrim(l.club_calendar_event_id), state = 'linked', sprocket_row = l.sprocket_row
      where id = r.id;
    if not (r.event_id = any (v_events)) then
      v_events := v_events || r.event_id;
    end if;
    v_count := v_count + 1;
  end loop;

  -- The event's own copy of its Sprocket rows (what the importer matches by;
  -- the 0035 trigger re-reads it and keeps the linked rows as they are).
  foreach v_event in array v_events loop
    update events e set
      app_managed = true,
      sprocket_event_ids = (select array_agg(x.club_calendar_event_id order by x.created_at, x.id)
                            from event_sprocket_rows x where x.event_id = e.id and x.state <> 'new'),
      sprocket_rows = (select jsonb_agg(x.sprocket_row order by x.created_at, x.id)
                       from event_sprocket_rows x where x.event_id = e.id and x.state <> 'new')
    where e.id = v_event;
  end loop;

  return v_count;
end;
$$;

revoke execute on function sprocket_link_rows(jsonb) from public, anon;
grant execute on function sprocket_link_rows(jsonb) to authenticated;

insert into locations (name, category, sprocket_location_id)
select v.name, 'regular', v.sid
from (values
  ('Sluggers Academy', '66190'),
  ('Medway Middle School', '70435'),
  ('Fore Kicks Sports Complex and Golf Course', '66775')
) as v(name, sid)
where not exists (select 1 from locations l where l.name = v.name or l.sprocket_location_id = v.sid);

select name, sprocket_location_id from locations where sprocket_location_id is not null order by name;
