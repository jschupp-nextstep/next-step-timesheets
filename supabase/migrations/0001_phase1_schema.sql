-- Phase 1: admin CRUD schema for coaches, programs, locations, rates, and events.
-- Applied manually via the Supabase SQL Editor (see README for instructions).

create table programs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null check (category in ('camp_nurse', 'regular')),
  half_day_hours numeric(5, 2),
  full_day_hours numeric(5, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint camp_nurse_hours_required check (
    category <> 'camp_nurse' or (half_day_hours is not null and full_day_hours is not null)
  )
);

create table coaches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initials text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table rates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches (id),
  program_id uuid not null references programs (id),
  hourly_rate numeric(8, 2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (coach_id, program_id)
);

create table one_v_one_rates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches (id),
  session_fee numeric(8, 2) not null,
  oversight_coach_id uuid references coaches (id),
  oversight_fee numeric(8, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (coach_id),
  constraint oversight_fee_requires_coach check (
    oversight_coach_id is not null or oversight_fee is null
  )
);

create table events (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs (id),
  location_id uuid not null references locations (id),
  event_date date not null,
  start_time time,
  end_time time,
  session_name text,
  notes text,
  is_cancelled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table programs enable row level security;
alter table locations enable row level security;
alter table coaches enable row level security;
alter table rates enable row level security;
alter table one_v_one_rates enable row level security;
alter table events enable row level security;

-- Admin-only for now: "authenticated" and "admin" are synonymous until Phase 2
-- introduces coach accounts through this same Supabase Auth system, at which
-- point these policies need to become role-aware.
create policy "Authenticated users manage programs" on programs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated users manage locations" on locations
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated users manage coaches" on coaches
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated users manage rates" on rates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated users manage one_v_one_rates" on one_v_one_rates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "Authenticated users manage events" on events
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Seed the six known program types so the list isn't empty on day one.
-- Codes are placeholders -- rename via the admin UI once real codes are decided.
insert into programs (name, code) values
  ('Annual Program', 'AP'),
  ('Town Sessions', 'TS'),
  ('Futsal', 'FUT'),
  ('Pathway', 'PATH'),
  ('1v1', '1V1'),
  ('Camp', 'CAMP');
