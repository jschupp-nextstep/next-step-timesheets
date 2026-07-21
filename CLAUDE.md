# Next Step Coach Timesheet App — Project Reference

## What this project is
Replacing Next Step's current Google Sheets + Apps Script payroll/timesheet system with a real
web app: **Refine + React + Vite** on **GitHub Pages** (frontend), **Supabase/Postgres with Row
Level Security** (backend). This doc is the persistent reference for the build — current system
behavior to replicate/fix, target architecture, decisions made, and where things stand.

---

## Why we're rebuilding (Option B, not a Sheets polish)

Considered "polish the existing Sheets/Apps Script system with a nicer frontend" (Option A) vs.
"rebuild on a real database" (Option B). Landed on **B**:

- The new coach-facing flow (select a *program*, then a *specific scheduled event* to log —
  instead of typing start/end times by hand) is a relational-data problem, not a spreadsheet
  problem. Building it in Sheets first would mean building it twice.
- The current system has already hit real structural failure modes from string-matching/VLOOKUP
  (see bugs below) — a real database with foreign keys eliminates the failure class rather than
  patching around it.
- Abandonment risk (only Justin deeply understands the system) is roughly a wash between A and B
  — no one else at Next Step is positioned to take over either version — so it made sense to pick
  the architecturally better option.
- Justin has full summer runway, wants to grow his own skills through the build, and wants this
  to become genuine Next Step IP.

---

## Current system (what exists today, being replaced)

- **Master spreadsheet**: one central file, Apps Script-driven, with a Payroll menu.
- **53 individual coach/nurse files**: one per coach, created from a shared template, each with
  its own bound Apps Script. Coaches log sessions into their own file; Master syncs from all of
  them via a Unique ID (UUID) stamped per row.
- Current versions: Master Timesheet Script v14, Coach Timesheet Script v8.

### Data model (roughly the schema the new app needs to cover)
- **Coaches**: Name, Initials (Coach_Roster tab)
- **Sessions/timesheet entries**: Name, Date, Program, Location, Session/Team Name, Start Time,
  End Time, Hours, Notes, Payment Status, Paid Date, Last Modified, Unique ID, Session Code
- **Program types**: label + code + active/inactive flag (SESSION_TYPES) — inactive types must
  stay valid for historical data, never hard-deleted
- **Rates**: Name + Program Type + Rate (hourly), exact-match lookup with fallback to that
  coach's "Coaching" rate only — no fallback to any other program type
- **1v1 Rates**: separate flat-fee-per-session structure (Session Fee + optional Oversight Coach
  + Oversight Fee)
- **Locations**: two categories, unified this session —
  - Camp/Nurse locations: Location + Half Day Hours + Full Day Hours (fixed hours by site)
  - Regular locations: just a name, hours computed from Start/End Time instead
  - Full combined location list now shown regardless of Program selected — no conditional
    restriction by Program type
- **Session Code format**: `TYPE_CODE-MMDD-HHMM-INITIALS`, generated from Program + Date + Start
  Time + Coach Initials — used to match against Sprocket exports during verification

### Business rules to preserve
- Hours for Camp/Nurse-type programs = fixed value looked up by Location, NOT calculated from
  Start/End Time (unused/locked for those program types)
- Hours for all other programs = calculated from Start/End Time
- Hours should be locked from manual entry (currently enforced via Sheets data-validation
  reject-input — new app can just make it a read-only computed field)
- Payment Due report: aggregates by coach, one Hours/$ column pair per program type, flags any
  coach+program combo missing a rate rather than silently defaulting to $0 or skipping
- Verification workflow: matches Master rows against a pasted Sprocket export, first by Session
  Code, falling back to Name+Date; flags MATCH / NOT ON TIMESHEET / NOT IN SPROCKET / CANCELLED /
  CANCELLED (no timesheet)

### Known structural bugs (the actual motivation for rebuilding)
- Trailing/leading spaces in coach names silently break exact-match lookups (VLOOKUP, session
  codes) — recurring issue, required TRIM() patches
- String-matching fragility generally: Program Type labels, Location names, coach names must
  match character-for-character across multiple tabs/files (e.g. "Town Session" vs.
  "Town Sessions")
- No real relational integrity — a coach in Rates but not Coach_Roster, or a Location typo, fails
  silently rather than erroring clearly
- Format mismatches: Sheets stores dates as Date objects vs. strings depending on source,
  requiring defensive normalizeDate_ handling
- Pushing logic updates across all 53 coach files required manual paste-in per file until a
  script-push system was built (Apps Script API + Cloud project + per-file Script ID mapping) —
  this whole mechanism becomes unnecessary with one real backend instead of 53 copies
  - *(Not needed going forward — this was a workaround specific to the spreadsheet architecture,
    with no equivalent in the new system.)*

---

## Target architecture

- **Frontend:** Refine (free, open-source, MIT-licensed React framework for internal-tool/admin
  CRUD apps) — chosen over Ant Design Pro, Shadcn Admin, and paid boilerplates like Supastarter,
  which either lock into an unwanted visual framework or bundle unused features (billing,
  multi-tenancy). Hosted on **GitHub Pages**, deployed from the new **"Next Step" GitHub
  organization account** (not Justin's personal account).
- **Backend:** **Supabase** (hosted Postgres + auth + auto-generated REST API). Frontend talks to
  Supabase directly from the browser via supabase-js — no separate server layer.
- **Auth:** magic-link or PIN-based coach login (no passwords to manage).
- **Security posture:** Data API **on**, "automatically expose new tables" **off** (manual
  control per table), automatic **RLS on** — this is the real access-control boundary since the
  frontend hits Supabase directly with a public key. Matters more given payroll/rate data sits in
  the same project as coach-facing data.
- **GitHub ↔ Supabase integration:** authorized, scoped to the one project repo. "Deploy to
  production" auto-migration toggle intentionally **off** for now until the workflow is trusted.
- Supabase organization type: **Startup** (cosmetic/onboarding categorization only, no effect on
  pricing/features).

### Data model (target)
- `coaches` — replaces Coach_Roster
- `programs` — Annual Program, Town Sessions, Futsal, Pathway, 1v1, Camp
- `events` — actual scheduled sessions (program, location, date/time) — replaces Camp_Locations;
  what coaches pick from instead of typing times
- `timesheet_entries` — coach + event + status + notes + payment status/paid date — replaces the
  Master tab
- `rates` — coach + program → rate, same fallback logic as current system

Session codes (TYPE-MMDD-HHMM-INITIALS) are likely retired — the event's own ID becomes the match
key, removing the need for the matching problem session codes existed to solve.

### Confirmed feature scope (beyond core log-a-session flow)
- **Date picker for past/current days**, not just "today" — coaches log Tuesday's session on
  Thursday, same event list, filtered by chosen date. **Policy question deliberately deferred:**
  should logging be allowed indefinitely into the past, or capped to something like the current
  pay period? Decision postponed until closer to Phase 2, since the answer may depend on how long
  the build takes (the old system is being kept running and stable in the meantime, so there's no
  urgency to lock this down now).
- **"My sessions" view**: coach's scheduled events split into logged vs. not-yet-logged, pulled
  from the same event data. Should shrink (not necessarily eliminate) the existing verification
  workflow, since gaps become visible in real time instead of being caught after the fact against
  Sprocket.
- **Payment status visibility**: toggle/tab between "Current" (pending) and "Paid history" (with
  paid date), built on the Payment Status / Paid Date fields that already exist today. One view
  with a filter, not two separate sections.

---

## Phased build plan

| Phase | Scope |
|---|---|
| 0 | Repo, Supabase project, deploy pipeline — bare-bones page live end to end |
| 1 | Admin CRUD for coaches/programs/events/rates (Refine's strength — largely auto-generated) |
| 2 | Coach-facing flow: log a session (program → event → submit) + "my sessions" view with date picker and logged/missing status. Bespoke, hand-built — not accelerated by Refine boilerplate. |
| 3 | Payroll views — Payment Due equivalent, payment status toggle, Paychex/Zoho exports |
| 4 | Reconciliation rework — likely smaller than today's system once events are real records |
| 5 (stretch) | Auto-populate events from Rob's calendar/Sprocket instead of manual entry |

Rough effort estimate: Phases 0–2 (usable coach-facing app) ≈ 20–30 hours; full 0–4 ≈ 30–45
hours. Justin has full summer runway, not a tight 2–3 week window.

---

## Tooling & logistics
- **Claude Code** (via Claude Desktop's Code tab) is the build environment going forward — better
  fit for multi-file, multi-session, run-commands-directly work than regular chat. Shares the
  same Pro/Max/Team usage pool as chat.
- **New "Next Step" GitHub org account** — separate from Justin's personal GitHub. Claude/GitHub
  logins don't need to match.
- **GitHub Copilot declined** for this account — redundant with Claude Code.
- This file (**CLAUDE.md**) is the project's persistent reference doc so future sessions don't
  require re-explaining context.

---

## Where things stand right now
Supabase project and GitHub integration are set up; security settings configured (Data API on,
auto-expose off, automatic RLS on). Ready to move into **Phase 0** inside Claude Code.

Not carried forward into the new build: the script-pusher/Cloud project/Apps Script API
infrastructure from the old system, and the debugging detours that produced it (Drive upload
conversion, OAuth scopes, GCP project creation) — that machinery was a workaround specific to the
spreadsheet architecture with no equivalent need here.
