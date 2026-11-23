-- Phase 9 step 5: export changes to sessions already in Sprocket.
--
-- app_settings.schedule_source_from -- the switch (target 1/1/2027): sessions
--   dated on/after it are scheduled in the app, so any change to them goes to
--   Sprocket. Before it (or while null) only sessions made in the app
--   (events.app_managed) are exported; imported ones are still edited in
--   Sprocket.
--
-- sprocket_mark_uploaded -- after an export file is uploaded to Sprocket,
--   each linked row's stored copy (event_sprocket_rows.sprocket_row = "what
--   Sprocket has") becomes the row that was sent, so the next export only
--   includes later changes. Re-sending an update by ID is harmless anyway;
--   this just keeps the list short. New rows (no ID yet) aren't touched --
--   they're linked with Link Sprocket IDs.
--
-- Additive.

alter table app_settings add column if not exists schedule_source_from date;

-- p_rows: [{row_id uuid, sprocket_row jsonb}]
create or replace function sprocket_mark_uploaded(p_rows jsonb) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can record a Sprocket upload.' using errcode = '42501';
  end if;
  update event_sprocket_rows x
    set sprocket_row = u.sprocket_row, last_uploaded_hash = md5(u.sprocket_row::text)
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as u(row_id uuid, sprocket_row jsonb)
  where x.id = u.row_id and x.state = 'linked'
    and x.club_calendar_event_id = u.sprocket_row ->> 'ClubCalendarEventID';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function sprocket_mark_uploaded(jsonb) from public, anon;
grant execute on function sprocket_mark_uploaded(jsonb) to authenticated;
