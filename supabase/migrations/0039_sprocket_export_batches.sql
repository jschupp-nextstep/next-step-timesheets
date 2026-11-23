-- Phase 9 step 6: a record of every Export to Sprocket file.
--
--   sprocket_export_batches      who made it, when, mode, date range,
--                                programs, the CSV itself (download again),
--                                and status:
--                                  waiting_upload -> uploaded | abandoned
--   sprocket_export_batch_rows   each event_sprocket_rows row in it, whether
--                                it was new (no ID) or a change, and the exact
--                                row sent.
--
-- Rules the export follows (and the functions enforce):
--   * A new row (no Sprocket ID yet) can be in only one open file: a file
--     waiting for upload holds it until it's marked uploaded or discarded; once
--     uploaded it stays out of exports until Link Sprocket IDs links it --
--     sending it again would create it twice in Sprocket.
--   * Changes (rows with an ID) can be re-sent any time; marking a file
--     uploaded makes each changed row's stored copy what was sent (as 0038's
--     sprocket_mark_uploaded did), so it isn't listed again.
--
-- Admins only, like the export page. Additive.

create table sprocket_export_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('changes', 'new')),
  range_from date not null,
  range_to date not null,
  program_ids uuid[] not null default '{}',
  csv text not null,
  new_rows int not null default 0,
  changed_rows int not null default 0,
  status text not null default 'waiting_upload' check (status in ('waiting_upload', 'uploaded', 'abandoned')),
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz
);

create table sprocket_export_batch_rows (
  batch_id uuid not null references sprocket_export_batches (id) on delete cascade,
  row_id uuid not null references event_sprocket_rows (id) on delete cascade,
  kind text not null check (kind in ('new', 'change')),
  sent_row jsonb not null,
  primary key (batch_id, row_id)
);
create index sprocket_export_batch_rows_row_idx on sprocket_export_batch_rows (row_id);

alter table sprocket_export_batches enable row level security;
alter table sprocket_export_batch_rows enable row level security;
revoke all on sprocket_export_batches, sprocket_export_batch_rows from anon, authenticated;
grant select on sprocket_export_batches, sprocket_export_batch_rows to authenticated;
create policy "Admins read sprocket_export_batches" on sprocket_export_batches for select using (is_admin());
create policy "Admins read sprocket_export_batch_rows" on sprocket_export_batch_rows for select using (is_admin());

-- p_rows: [{row_id uuid, kind 'new'|'change', sent_row jsonb}]
create or replace function sprocket_create_batch(
  p_mode text, p_from date, p_to date, p_program_ids uuid[], p_csv text, p_rows jsonb
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
  if jsonb_array_length(coalesce(p_rows, '[]')) = 0 then
    raise exception 'Nothing to export.' using errcode = '22023';
  end if;

  -- A new row already in an open file (waiting, or uploaded and not yet
  -- linked) can't go into another one.
  select string_agg(distinct to_char(e.event_date, 'FMMM/FMDD') || coalesce(' ' || e.session_name, ''), ', ')
    into v_held
  from jsonb_to_recordset(p_rows) as u(row_id uuid, kind text, sent_row jsonb)
  join event_sprocket_rows x on x.id = u.row_id
  join events e on e.id = x.event_id
  where u.kind = 'new'
    and (x.state <> 'new' or exists (
      select 1 from sprocket_export_batch_rows br join sprocket_export_batches b on b.id = br.batch_id
      where br.row_id = u.row_id and br.kind = 'new' and b.status in ('waiting_upload', 'uploaded')));
  if v_held is not null then
    raise exception 'Already in another export file (or linked): %. Check sessions again.', v_held using errcode = '22023';
  end if;

  insert into sprocket_export_batches (created_by, created_by_email, mode, range_from, range_to, program_ids, csv,
                                       new_rows, changed_rows)
  values (auth.uid(), lower(auth.jwt() ->> 'email'), p_mode, p_from, p_to, coalesce(p_program_ids, '{}'), p_csv,
          (select count(*) from jsonb_array_elements(p_rows) r where r ->> 'kind' = 'new'),
          (select count(*) from jsonb_array_elements(p_rows) r where r ->> 'kind' = 'change'))
  returning id into v_batch;

  insert into sprocket_export_batch_rows (batch_id, row_id, kind, sent_row)
  select v_batch, u.row_id, u.kind, u.sent_row
  from jsonb_to_recordset(p_rows) as u(row_id uuid, kind text, sent_row jsonb);

  update event_sprocket_rows set last_batch_id = v_batch
  where id in (select (r ->> 'row_id')::uuid from jsonb_array_elements(p_rows) r);

  return v_batch;
end;
$$;

-- Uploaded: changed rows' stored copy becomes what was sent. Discarded: the
-- file's new rows are free to export again.
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
  end if;
end;
$$;

revoke execute on function sprocket_create_batch(text, date, date, uuid[], text, jsonb) from public, anon;
grant execute on function sprocket_create_batch(text, date, date, uuid[], text, jsonb) to authenticated;
revoke execute on function sprocket_decide_batch(uuid, text) from public, anon;
grant execute on function sprocket_decide_batch(uuid, text) to authenticated;
