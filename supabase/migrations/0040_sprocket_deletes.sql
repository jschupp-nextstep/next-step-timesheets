-- Phase 9 step 7: deleting a session, and telling Sprocket.
--
-- Until now the app had no way to delete a session (only cancel). This adds:
--
--   schedule_delete_event(event, reason) -- admin only. Refuses a session
--     with logged hours, claims or swap requests (cancel it instead: those
--     records point at it). Coaches' assignments and its history go with it.
--
--   sprocket_deletions -- when a session that's in Sprocket is deleted (by
--     that function or any other way), a trigger keeps a note of each of its
--     Sprocket rows so Export to Sprocket can send them as DeleteEvent=Yes:
--       pending  -- to send
--       sent     -- in an export file marked uploaded
--       manual   -- uploaded to Sprocket but never linked, so there's no ID
--                   to delete by: delete it in Sprocket by hand, then Done
--       done     -- handled by hand
--     The importer also skips these IDs, so a session deleted here doesn't
--     come back on the next Sprocket import.
--
--   Export files (0039) gain deletes: sprocket_export_batch_deletions, a
--   deleted_rows count, and a 7-argument sprocket_create_batch(..., p_deletes).
--   The 6-argument one stays for the deployed page until the push.
--
-- Additive (new tables/functions, a trigger, a replaced function with the
-- same signature).

create table sprocket_deletions (
  id uuid primary key default gen_random_uuid(),
  club_calendar_event_id text unique,
  sprocket_row jsonb,
  event_date date not null,
  label text not null,
  reason text,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  deleted_by_email text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'manual', 'done')),
  constraint sprocket_deletions_id_unless_manual check (status in ('manual', 'done') or club_calendar_event_id is not null)
);

create table sprocket_export_batch_deletions (
  batch_id uuid not null references sprocket_export_batches (id) on delete cascade,
  deletion_id uuid not null references sprocket_deletions (id) on delete cascade,
  sent_row jsonb not null,
  primary key (batch_id, deletion_id)
);

alter table sprocket_export_batches add column if not exists deleted_rows int not null default 0;

alter table sprocket_deletions enable row level security;
alter table sprocket_export_batch_deletions enable row level security;
revoke all on sprocket_deletions, sprocket_export_batch_deletions from anon, authenticated;
grant select on sprocket_deletions, sprocket_export_batch_deletions to authenticated;
create policy "Admins read sprocket_deletions" on sprocket_deletions for select using (is_admin());
create policy "Admins read sprocket_export_batch_deletions" on sprocket_export_batch_deletions for select using (is_admin());

-- Before a session is deleted: note its Sprocket rows.
create or replace function events_note_sprocket_deletion() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_label text := to_char(old.event_date, 'Dy FMMM/FMDD')
    || coalesce(' ' || to_char(old.start_time, 'FMHH12:MI AM'), '')
    || coalesce(' · ' || old.session_name, '')
    || coalesce(' · ' || (select name from locations where id = old.location_id), '');
  v_reason text := nullif(current_setting('app.delete_reason', true), '');
begin
  insert into sprocket_deletions (club_calendar_event_id, sprocket_row, event_date, label, reason, deleted_by, deleted_by_email, status)
  select x.club_calendar_event_id, x.sprocket_row, old.event_date,
         v_label || coalesce(' · ' || (select name from sprocket_teams t where t.sprocket_team_id = x.sprocket_team_id), ' · Club'),
         v_reason, auth.uid(), lower(auth.jwt() ->> 'email'), 'pending'
  from event_sprocket_rows x
  where x.event_id = old.id and x.state = 'linked' and x.club_calendar_event_id is not null
  on conflict (club_calendar_event_id) do nothing;

  -- In Sprocket (an uploaded file) but never linked: no ID to send.
  insert into sprocket_deletions (club_calendar_event_id, sprocket_row, event_date, label, reason, deleted_by, deleted_by_email, status)
  select null, null, old.event_date,
         v_label || coalesce(' · ' || (select name from sprocket_teams t where t.sprocket_team_id = x.sprocket_team_id), ' · Club'),
         v_reason, auth.uid(), lower(auth.jwt() ->> 'email'), 'manual'
  from event_sprocket_rows x
  where x.event_id = old.id and x.state = 'new'
    and exists (select 1 from sprocket_export_batch_rows br join sprocket_export_batches b on b.id = br.batch_id
                where br.row_id = x.id and br.kind = 'new' and b.status = 'uploaded');
  return old;
end;
$$;

revoke execute on function events_note_sprocket_deletion() from public, anon, authenticated;

create trigger events_note_sprocket_deletion
  before delete on events
  for each row execute function events_note_sprocket_deletion();

create or replace function schedule_delete_event(p_event_id uuid, p_reason text) returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_reason text;
  v_rows int;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can delete a session. Cancel it instead.' using errcode = '42501';
  end if;
  v_reason := schedule_require_reason(p_reason);
  if not exists (select 1 from events where id = p_event_id) then
    raise exception 'That session no longer exists.' using errcode = 'P0002';
  end if;
  if exists (select 1 from timesheet_entries where event_id = p_event_id) then
    raise exception 'Can''t delete: hours have been logged on this session. Cancel it instead.' using errcode = '22023';
  end if;
  if exists (select 1 from payment_claims where event_id = p_event_id)
     or exists (select 1 from swap_requests where event_id = p_event_id) then
    raise exception 'Can''t delete: there are claims or swap requests on this session. Cancel it instead.' using errcode = '22023';
  end if;

  select count(*) into v_rows from event_sprocket_rows where event_id = p_event_id and state = 'linked';
  perform set_config('app.delete_reason', v_reason, true);
  delete from events where id = p_event_id;
  perform set_config('app.delete_reason', '', true);
  return v_rows;
end;
$$;

revoke execute on function schedule_delete_event(uuid, text) from public, anon;
grant execute on function schedule_delete_event(uuid, text) to authenticated;

-- p_rows as in 0039; p_deletes: [{deletion_id uuid, sent_row jsonb}]
create or replace function sprocket_create_batch(
  p_mode text, p_from date, p_to date, p_program_ids uuid[], p_csv text, p_rows jsonb, p_deletes jsonb
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_held text;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can export to Sprocket.' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]')) + jsonb_array_length(coalesce(p_deletes, '[]')) = 0 then
    raise exception 'Nothing to export.' using errcode = '22023';
  end if;

  select string_agg(distinct to_char(e.event_date, 'FMMM/FMDD') || coalesce(' ' || e.session_name, ''), ', ')
    into v_held
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as u(row_id uuid, kind text, sent_row jsonb)
  join event_sprocket_rows x on x.id = u.row_id
  join events e on e.id = x.event_id
  where u.kind = 'new'
    and (x.state <> 'new' or exists (
      select 1 from sprocket_export_batch_rows br join sprocket_export_batches b on b.id = br.batch_id
      where br.row_id = u.row_id and br.kind = 'new' and b.status in ('waiting_upload', 'uploaded')));
  if v_held is not null then
    raise exception 'Already in another export file (or linked): %. Check sessions again.', v_held using errcode = '22023';
  end if;

  select string_agg(d.label, ', ') into v_held
  from jsonb_to_recordset(coalesce(p_deletes, '[]')) as u(deletion_id uuid, sent_row jsonb)
  join sprocket_deletions d on d.id = u.deletion_id
  where d.status <> 'pending' or exists (
    select 1 from sprocket_export_batch_deletions bd join sprocket_export_batches b on b.id = bd.batch_id
    where bd.deletion_id = d.id and b.status = 'waiting_upload');
  if v_held is not null then
    raise exception 'Delete already sent or in a file waiting for upload: %. Check sessions again.', v_held using errcode = '22023';
  end if;

  insert into sprocket_export_batches (created_by, created_by_email, mode, range_from, range_to, program_ids, csv,
                                       new_rows, changed_rows, deleted_rows)
  values (auth.uid(), lower(auth.jwt() ->> 'email'), p_mode, p_from, p_to, coalesce(p_program_ids, '{}'), p_csv,
          (select count(*) from jsonb_array_elements(coalesce(p_rows, '[]')) r where r ->> 'kind' = 'new'),
          (select count(*) from jsonb_array_elements(coalesce(p_rows, '[]')) r where r ->> 'kind' = 'change'),
          jsonb_array_length(coalesce(p_deletes, '[]')))
  returning id into v_batch;

  insert into sprocket_export_batch_rows (batch_id, row_id, kind, sent_row)
  select v_batch, u.row_id, u.kind, u.sent_row
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as u(row_id uuid, kind text, sent_row jsonb);

  insert into sprocket_export_batch_deletions (batch_id, deletion_id, sent_row)
  select v_batch, u.deletion_id, u.sent_row
  from jsonb_to_recordset(coalesce(p_deletes, '[]')) as u(deletion_id uuid, sent_row jsonb);

  update event_sprocket_rows set last_batch_id = v_batch
  where id in (select (r ->> 'row_id')::uuid from jsonb_array_elements(coalesce(p_rows, '[]')) r);

  return v_batch;
end;
$$;

revoke execute on function sprocket_create_batch(text, date, date, uuid[], text, jsonb, jsonb) from public, anon;
grant execute on function sprocket_create_batch(text, date, date, uuid[], text, jsonb, jsonb) to authenticated;

-- Same as 0039, plus: an uploaded file's deletes are sent.
create or replace function sprocket_decide_batch(p_batch_id uuid, p_status text) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  b sprocket_export_batches%rowtype;
begin
  if not is_admin() then
    raise exception 'Not allowed: only an admin can record a Sprocket upload.' using errcode = '42501';
  end if;
  if p_status not in ('uploaded', 'abandoned') then
    raise exception 'Unknown status "%".', p_status using errcode = '22023';
  end if;
  select * into b from sprocket_export_batches where id = p_batch_id for update;
  if not found then
    raise exception 'That export file no longer exists.' using errcode = 'P0002';
  end if;
  if b.status <> 'waiting_upload' then
    raise exception 'That file was already marked %.', case b.status when 'uploaded' then 'uploaded' else 'discarded' end
      using errcode = '22023';
  end if;

  update sprocket_export_batches
    set status = p_status, decided_by = auth.uid(), decided_by_email = lower(auth.jwt() ->> 'email'), decided_at = now()
    where id = p_batch_id;

  if p_status = 'uploaded' then
    update event_sprocket_rows x
      set sprocket_row = br.sent_row, last_uploaded_hash = md5(br.sent_row::text)
    from sprocket_export_batch_rows br
    where br.batch_id = p_batch_id and br.row_id = x.id and br.kind = 'change' and x.state = 'linked';
    update sprocket_deletions d set status = 'sent'
    from sprocket_export_batch_deletions bd
    where bd.batch_id = p_batch_id and bd.deletion_id = d.id and d.status = 'pending';
  end if;
end;
$$;

-- A "delete by hand" one, done in Sprocket.
create or replace function sprocket_deletion_done(p_deletion_id uuid) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update sprocket_deletions set status = 'done' where id = p_deletion_id and status = 'manual';
  if not found then
    raise exception 'That one is already handled -- reload the page.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function sprocket_deletion_done(uuid) from public, anon;
grant execute on function sprocket_deletion_done(uuid) to authenticated;
