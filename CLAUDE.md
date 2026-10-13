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

### Data model (as built — see "Where things stand right now" for full detail)
- `coaches` — replaces Coach_Roster. Gained `email` (nullable, unique — links a coach's roster
  record to their Supabase Auth login by match, no manually-copied user ID) and `pay_type`
  (`1099`/`w2`, default `1099` — drives which Zoho Books accounts a coach's pay routes to)
- `programs` — Annual Program, Town Sessions, Futsal, Pathway, 1v1, Camp, plus several added
  during the build (Office Hours, Set-up/Break-down, Stipend, Coaching, Camp-Half/Full Day,
  Nurse-Half/Full Day, Reimbursement). Gained `entry_mode` (`session` / `direct_time` /
  `direct_flat` / `admin_only` / `backend_only` / `reimbursement`) — drives which coach-facing UI
  flow, if any, a program uses (see below)
- `events` — actual scheduled sessions (program, location, date/time) — replaces Camp_Locations;
  what coaches pick from instead of typing times. Admin CRUD, plus two bulk-load paths now: the
  Sprocket CSV importer and the native bulk importer (`/bulk-import` — see "Native bulk importer"
  below)
- `event_assignments` — new table, not in the original plan: which coach(es) are actually
  scheduled to work a given event. Populated by the Sprocket importer, the native bulk importer,
  or by hand via the admin Schedule Board (`/schedule-board`, added in the scheduling &
  coach-confirmation work — see below). Gained `coach_confirmed_at` (tap-to-confirm) alongside a
  column-scoped RLS grant so a coach can only ever update that one column on their own row.
- `timesheet_entries` — coach + event (nullable) + location (nullable) + status + notes + payment
  status/paid date — replaces the Master tab. Gained `flat_amount` (captures a dollar amount at
  creation time for flat-fee/reimbursement entries, rather than recomputing from current rates)
- `rates` — coach + program → hourly rate, same fallback logic as current system (exact match,
  then that coach's "Coaching" rate, never any other program's rate, never a silent $0)
- `one_v_one_rates` — flat session fee per coach, plus an optional oversight coach + oversight fee
- `oversight_approvals` — new table, not in the original plan: not every 1v1 session with an
  oversight coach configured actually had oversight happen, so an admin confirms each one
  individually; approving creates a real, separately-payable `timesheet_entries` row for the
  oversight coach rather than it being an invisible side calculation
- `swap_requests` — new table, not in the original plan: coach-initiated, admin-approved requests
  to be removed from an assigned event (see "Phase 5 continued" below). Unlike
  `oversight_approvals`, this has a real live `pending` state with admin UPDATE rights, since a
  request can sit visibly pending before either the coach or an admin acts on it.
- `pay_periods` — new table, not in the original plan: simple admin-managed start/end date
  reference rows, hand-correctable rather than computed off a fixed cadence. Exists purely to
  define the coach-facing logging-window bands (see "Pay-period logging windows" below).
- `payment_claims` — new table, not in the original plan: one review queue, four claim types
  (`late_event`, `unassigned_claim`, `unstructured`, `hours_correction`), same live-`pending`-state
  pattern as `swap_requests` rather than `oversight_approvals`' insert-only shape.

Session codes (TYPE-MMDD-HHMM-INITIALS) were retired entirely, as predicted — the event's own ID
is the match key. ~~There turned out to be no Sprocket-side stable ID either (its CSV export has no
ID column)~~ — **corrected 2026-10-13:** the calendar export *does* have `ClubCalendarEventID`,
unique on every row of the July export (one per staff row for Camps, one per session otherwise).
Not yet confirmed stable across re-exports, but if it is, the importer upgrade below can match
by it instead of by a field signature.

**Coach-facing entry_mode summary** (relevant since it's easy to assume more is covered than is):
`session` (pick a real calendar event) and `direct_time` (Office Hours: date + start/end time, no
calendar tie-in) are both fully coach self-service, as is an "Other (not on the calendar)" escape
hatch inside the `session` flow for a real session that isn't on the calendar. `direct_flat` (1v1)
is also coach self-service (pick a session length, no calendar tie-in). `admin_only` (Set-up/
Break-down, Stipend) is **never shown to a coach at all** — an admin has to enter these by hand on
the generic Timesheet Entries admin screen (`/entries/create` — which, despite this line predating
it, didn't actually exist until the cutover work on 2026-10-12; before that the admin screen was
list/edit only); there is no coach-initiated request/approval flow for
this, unlike the oversight-fee pattern above. `backend_only` (Coaching) isn't a loggable entry
type on either side — it exists purely as the rate-lookup fallback target.

### Confirmed feature scope (beyond core log-a-session flow)
- **Date picker for past/current days**, not just "today" — coaches log Tuesday's session on
  Thursday, same event list, filtered by chosen date. **Policy question resolved** (was
  deliberately deferred here since Phase 2): see "Pay-period logging windows" below — self-service
  is capped to the current pay period + 1 back; anything older routes through the
  `payment_claims` review queue instead of being blocked outright or left unlimited.
- **"My sessions" view**: coach's scheduled events split into logged vs. not-yet-logged, pulled
  from the same event data. Should shrink (not necessarily eliminate) the existing verification
  workflow, since gaps become visible in real time instead of being caught after the fact against
  Sprocket.
- **Payment status visibility**: toggle/tab between "Current" (pending) and "Paid history" (with
  paid date), built on the Payment Status / Paid Date fields that already exist today. One view
  with a filter, not two separate sections.

---

## Phased build plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo, Supabase project, deploy pipeline — bare-bones page live end to end | ✅ Done |
| 1 | Admin CRUD for coaches/programs/events/rates (Refine's strength — largely auto-generated) | ✅ Done |
| 2 | Coach-facing flow: log a session (program → event → submit) + "my sessions" view with date picker and logged/missing status. Bespoke, hand-built — not accelerated by Refine boilerplate. | ✅ Done, plus coach self-service edit/delete on pending entries (not originally scoped) |
| 3 | Payroll views — Payment Due equivalent, payment status toggle, Paychex/Zoho exports | 🟡 Payment Due + toggle + Zoho export done; no Paychex export exists. Confirmed acceptable — W-2 pay runs through a separate service outside this app; only one-off `admin_only` entries (stipends) for a W-2 coach have no export path today, though Payment Due still tracks them and reimbursements already flow into the Zoho CSV regardless of pay_type |
| 4 | Reconciliation rework — likely smaller than today's system once events are real records | ✅ Done, plus the 1v1 oversight-fee approval workflow (not originally scoped) |
| 5 (stretch) | Auto-populate events from Rob's calendar/Sprocket instead of manual entry | 🟡 Sprocket importer, admin scheduling board, coach tap-to-confirm, and swap requests done; export-to-Sprocket + importer reconciliation upgrade still blocked on the bulk-import template — see "Where things stand right now" |
| 6 (not originally scoped) | Pay-period logging windows + payment claims review queue | ✅ Done, deployed 2026-09-27 — see "Pay-period logging windows" below |
| 7 (not originally scoped) | Native bulk importer for events/event_assignments | ✅ Done, deployed 2026-09-27 — see "Native bulk importer" below |
| 8 (payroll lessons, Oct 2026) | R1–R9 from the Sep 1–Oct 6 Sheets payroll run — see "Payroll lessons" below | 🟡 Payment Due date range + R1 cutover done 2026-10-12; R2 done 2026-10-13 (R2a roles, R2b logged quick actions, R2c review queue + payroll hold, R2d swap-with-replacement); R3 paid-time rules done 2026-10-13; R8 minimal (paid rate/amount saved at payment) done 2026-10-13; R4–R7, R9 and the rest of R8 (rate effective dates, adjustments) not started |

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

### Migration ↔ deploy rule (added 2026-10-12)

Migrations are run by hand in the SQL Editor and the frontend deploys on push to `main`, so for a
while one is live without the other. **Every migration must work with both the currently deployed
code and the new code — or be run at the same moment as the matching push — so the live site never
breaks in between.** Learned the hard way in R2b: `0020` added a second FK from `event_assignments`
to `coaches`, which made the deployed Schedule Board's `coaches(name)` embed ambiguous and broke it
until the push landed. Practical checklist before handing over a migration:
- Additive first (new tables/columns/functions), removals and renames only after the code that
  stops using them is deployed.
- Anything that changes how existing queries resolve (new FKs, dropped columns, tightened RLS,
  renamed functions) — check the deployed code's queries against it, and ship the compatible code
  *first* when possible (e.g. FK-name hints work before the second FK exists).
- If that's impossible, say so explicitly and run the migration and the push together.

## Where things stand right now

Phases 0–4 are complete and deployed (GitHub Actions → GitHub Pages on every push to `main`).
The app is in real use: admin CRUD for all reference data, coach login (magic link + password) and
self-service session logging/editing, a Sprocket calendar importer, Reconciliation, Payment Due,
and a combined Zoho Books export. Full schema is in `supabase/migrations/0001`–`0024`, applied
manually via the Supabase SQL Editor (no working Supabase CLI auth as of this session — a
migration file existing here doesn't guarantee nothing else was changed directly in the dashboard,
worth a spot-check if that's ever suspected).

**Active work — Phase 5.** `events`/`event_assignments` get populated by importing a Sprocket
calendar CSV export (one-way, manual, admin-run from `/sprocket-import`), or, as of the scheduling
& coach-confirmation work below, by hand from the admin Schedule Board. There's still no way to
push events created here back out to Sprocket. Goal: make the app the actual source of truth
rather than a mirror of Sprocket. Two pieces were identified; the first is done:

1. ~~**Admin coach-assignment UI**~~ — ✅ done, see "Phase 5 continued" below (the Schedule Board).
2. **Export to Sprocket** — a CSV formatted for Sprocket's bulk-import template (shape TBD; the
   template file was supposed to be shared into the project folder but hasn't landed yet due to a
   filesystem permission issue reading the user's Downloads folder — needed before this can be
   designed).

**Decided reconciliation policy** (this changes `/sprocket-import`'s behavior, not just adds to
it): on re-import, if an event is recognized as one already in the app, **Sprocket's data wins —
straight overwrite of assignments/time/cancellation, no merge**. The app stays authoritative only
for events Sprocket doesn't have yet. Concretely this requires two changes to the importer, not
yet made:
- The existing dedup signature (`program_id, location_id, event_date, start_time, end_time,
  session_name`) bakes mutable fields (time, and implicitly cancellation) into event *identity*.
  That has to be narrowed to just the fields that name *which* event this is (date, location,
  program, session name/title), so a Sprocket-side time correction updates the existing event
  instead of silently creating a duplicate. ~~Known unavoidable gap: since Sprocket's own export has
  no stable event ID (confirmed by reading its CSV shape), a genuine reschedule to a different
  date is indistinguishable from "old event cancelled, new one created."~~ *Probably avoidable
  after all — see the `ClubCalendarEventID` correction in "Data model" above; worth confirming
  that ID survives a re-export before relying on it.*
- `event_assignments` handling changes from add-only to delete-and-replace on a recognized match,
  so a dropped/swapped coach in Sprocket actually gets removed here too, not just appended to.

Item 2 (export) and the importer reconciliation upgrade above are both still blocked on seeing
Sprocket's actual bulk-import column layout.

Not carried forward from the old system: the script-pusher/Cloud project/Apps Script API
infrastructure, and the debugging detours that produced it (Drive upload conversion, OAuth scopes,
GCP project creation) — that machinery was a workaround specific to the spreadsheet architecture
with no equivalent need here.

---

### Before coach rollout (to-do)

Found 2026-10-12: only 1 of 61 active coaches (TEST COACH) has an email on the roster, so
coaches aren't actually logging in yet — the app's real use so far is admin-side.

- [ ] **Custom SMTP for Supabase Auth email** (e.g. Resend). The built-in sender is capped at
  ~2–4 emails/hour; 60 coaches requesting magic links on launch day would hit it.
- [ ] **Collect coach emails** (Name,Email CSV) and run `scripts/provision-coach-logins.mjs` —
  dry run by default, `--apply` to write. Sets `coaches.email` (lowercased, name-matched exactly,
  unmatched names listed never guessed) and creates pre-confirmed Auth users with no email sent.
  Needs `SUPABASE_SERVICE_ROLE_KEY` as an env var for that run only — never in `.env.local`.
- [ ] **Create real pay periods** (`/pay-periods`). Found 2026-10-13: the table is **empty**, so
  every date classifies as Band C — no coach can log or "Confirm hours" on a calendar session at
  all, only file an `unstructured` claim. Needs at least the current period (and ideally 3 back)
  before go-live.
- "Allow new users to sign up" is **off** in Supabase Auth (turned off 2026-10-12), so every login
  must be created deliberately: the script above, or Authentication → Users → Add user.

## Phase 5 continued — scheduling & coach confirmation (✅ done, deployed 2026-09-26)

Scoped in a claude.ai planning session on 2026-08-30, then reviewed against the actual codebase
in Claude Code and corrected before being recorded here. Built and verified end-to-end (schedule
board assign/multi-assign, event recurrence + assign-on-create, coach "I'll be there", "Confirm
hours", coach-side swap request, and admin approve/deny) against the real Supabase project on
2026-09-26, then committed and deployed. Sequencing was board view → tap-to-confirm → swap
requests, in that order, each verified working before the next started — the notes below are kept
as the design record, not a still-open TODO. The Sprocket export and importer reconciliation
upgrade described above remain unbuilt and are unaffected by this work.

### Admin scheduling board
- Weekly board view (day columns, time-slotted event cards), color-coded by assignment status.
  **This is the largest single piece of net-new UI in the whole plan**, not a one-line bullet —
  every existing admin screen in this app (`coaches`, `programs`, `locations`, `events`, `entries`)
  is a Refine `<Table>` list/create/edit; there is no calendar/grid/day-column pattern anywhere in
  the codebase to build from, and Ant Design's own `Calendar` component (unused here) is
  month-view-oriented, not a time-slotted weekly board. Budget for it as comparable in size to
  building the Sprocket importer.
- Unfilled events visually distinct (e.g. dashed border). Needs two independent visual dimensions,
  not one: fill status (empty/partial/full) and cancelled status — an event can be both cancelled
  and unfilled at the same time.
- Clicking a slot opens an inline coach picker; writes to `event_assignments` the same way the
  Sprocket importer does today. **Explicitly supports adding additional coaches to an
  already-partially-assigned event, not just empty-to-one** — Camp events routinely have several
  coaches on one event (the reason the importer collapses per-staff Sprocket rows into one event +
  N assignments in the first place), so the picker has to handle that from day one, not as a later
  add-on.
- **"Add session"**: not a standalone new screen — extends the existing `events/create.tsx`, which
  already has the program/location/date/start/end-time form. The only new piece is an optional
  coach-assign step on the same submit (insert into `events`, then conditionally insert into
  `event_assignments`).
- **Recurrence**: "Does not repeat / Weekly / Weekly for N weeks" — materializes as N separate
  `events` rows (date +7 days each), not a recurrence-template concept. `events` gains a nullable
  `series_id` (uuid), set to the same value on every row created together in one recurring batch,
  null for one-off events. Not used for anything at insert time beyond tagging — the board later
  reads it to pre-select "the series" for bulk edit, so that's a real backing relationship rather
  than the admin manually multi-selecting similar-looking cards with nothing tying them together.

### Coach: tap-to-confirm
Two distinct actions on `/my-sessions`, for assigned events:
- **"I'll be there"** (pre-session) — lightweight confirm, flips a new
  `event_assignments.coach_confirmed_at` column. Doesn't touch `timesheet_entries`.
- **"Confirm hours"** (post-session) — creates a `timesheet_entries` row pre-filled from the
  event's date/time/location/program, editable if it ran long/short. **Implemented by routing
  through `log-session.tsx`'s existing hours-resolution logic and edit-mode/pre-populate pattern**
  (`resolveEventHours`, the `FIXED_HOURS_HALF`/`FIXED_HOURS_FULL` lookup against a location's
  configured hours for Camp/Nurse, `timeSpanHours` for everything else, and the same pre-populate
  approach `/log-session/edit/:id` already uses) — not a new bespoke form that reimplements that
  branching a second time.
- The existing manual `/log-session` wizard is unchanged and stays the path for anything
  off-calendar (ad-hoc, office hours, stipends).

### Swap requests (admin-approved only — no direct coach-to-coach swaps)
- New table, record shape loosely modeled on `oversight_approvals` but **not** its RLS/mutation
  pattern — those are genuinely different, confirmed by reading the actual implementation.
  `oversight_approvals` is insert-only: `decide()` in `reconciliation/index.tsx` only ever inserts
  an already-decided row, and "pending" there just means no row exists yet — there is no admin
  update path on that table at all. `swap_requests` needs a real live pending state instead (a
  coach creates the request before any decision exists, and both the coach and an admin need to
  see it sitting there), so it needs an actual `status` column (`pending`/`approved`/`denied`)
  that gets updated in place — meaning admins need UPDATE rights on this table, which
  `oversight_approvals` never needed.
- Columns: `coach_id`, `event_id`, `reason`, `status`, `requested_at`, `reviewed_by` (bare `uuid`,
  no FK — there is no `admins` table anywhere in this schema; "admin" is purely "an authenticated
  user whose email doesn't match any `coaches.email`," per `is_admin()`), `reviewed_at`.
- No unique-per-source-entry constraint. `oversight_approvals.source_entry_id` is unique because
  that's a one-time, irreversible decision about a session that already happened — wrong fit here,
  since a denied coach may legitimately want to re-request later. Instead, a **partial unique
  index on `(event_id, coach_id) where status = 'pending'`** — blocks duplicate simultaneous
  pending requests for the same event/coach without blocking a later re-request after denial.
- Coach-side: "Request swap" on an assigned session in `/my-sessions`, with a reason field.
- **Only offered before "Confirm hours" has happened for that event.** Once a `timesheet_entries`
  row exists for that coach/event, any correction is an admin edit on the Timesheet Entries admin
  page, not a swap. This sidesteps the stale-entry problem entirely: since a swap can never be
  requested (let alone approved) once hours are confirmed, approval never needs to reconcile or
  clean up a `timesheet_entries` row, and no cascade/delete logic needs to be built for it.
- Admin-side: review queue, likely near `/reconciliation` (same general area as the oversight-fee
  queue, though the query itself is just `where status = 'pending'` — simpler than that queue's
  anti-join, since status is stored directly here instead of inferred from row absence). Approval
  removes the coach from `event_assignments` — the event becomes unfilled again and gets refilled
  through the same board assign flow, no separate reassignment logic. Denial just marks the
  request resolved (`status = 'denied'`), no other change. *(Updated in R2: removal now goes
  through the logged `schedule_remove`, and since R2d approval can also name a replacement,
  which runs `schedule_sub` in the same step — see "R2d" below.)*

### RLS — designed deliberately for this feature, not copy-pasted
- `event_assignments`: migration `0004` already grants blanket `select, insert, update, delete` on
  this table to every `authenticated` user — RLS only filters *which rows* a policy allows, never
  *which columns*. A naive `coach_id = current_coach_id()` UPDATE policy alone would let a coach
  also rewrite `event_id` or `program_id` on their own assignment row via a raw REST call, not
  just `coach_confirmed_at`. Needed:
  ```sql
  revoke update on event_assignments from authenticated;
  grant update (coach_confirmed_at) on event_assignments to authenticated;
  ```
  paired with a coach RLS policy scoped to `coach_id = current_coach_id()` on both `using` and
  `with check` (the `with check` alone already stops a coach reassigning the row to a different
  `coach_id`, since the post-update row would fail the check). Admins still need full-column
  update — that needs its own path (a broader grant gated by `is_admin()` in RLS, or a
  `security definer` function) so this narrower grant doesn't also cap admin writes.
- `swap_requests`: coach gets `insert` (`with check coach_id = current_coach_id()`) and `select`
  (`using coach_id = current_coach_id()`) — the select is required, not optional, so a coach can
  actually see a denial rather than it silently happening with no feedback in their UI. Admin gets
  `select`/`update` via `is_admin()` for reviewing and deciding. Coach delete is intentionally
  left undesigned for now (a coach wanting to withdraw a request they no longer need can be a
  later addition, not required for this to ship).

### Explicitly deferred
Broadcasting an open/swapped session to a pool of coaches for first-to-accept was scoped and
intentionally parked — real notification infrastructure (email/SMS) and a race-condition-safe
"first tap wins" mechanism, meaningfully bigger than the rest of this list. Not to be picked up
before the above ships.

### Schedule import bridge (Nick, Luis) — two different pipelines, not one
Nick produces a weekly schedule as an LLM-generated image (day/time grid, color-coded by coach);
Luis tracks Annual Program hours in a spreadsheet (date × coach matrix of durations, no
location/session data — a genuinely different shape than Nick's, not just a different file
format). Decided **not** to build bespoke in-app parsers for either.

- **Nick's data** maps naturally onto Sprocket's calendar-CSV shape (it has locations, times, and
  coaches — what `parseSprocketCsv.ts` actually needs) and goes through the existing
  Sprocket-CSV import path unchanged. A Team Claude Project (outside this codebase) translates the
  image into that CSV shape; whoever runs the translation (likely Ella) uploads it through
  `/sprocket-import` like any other export. Worth remembering `parseSprocketCsv.ts` has real
  idiosyncrasies the translation needs to reproduce, not just matching column headers — role
  suffixes encoded in `Title`, coach names embedded in `TeamName` with specific suffix-stripping,
  the `PROGRAM_NAME_MAP` translation table — so this isn't guaranteed correct on the first attempt
  the way "same CSV shape" makes it sound. The existing importer's manual review/mapping step
  (already required for every Sprocket import regardless of source) is exactly the safety net that
  catches a mismatch here too, so this is lower-risk than it would be without that step existing.
- **Luis's data doesn't fit that pipeline at all** — Sprocket's CSV format requires `Title`/
  `StartDate`/`LocationName` at minimum for every row; hours-with-no-location isn't a calendar
  event. It needs a different, lighter path — most likely straight into `timesheet_entries` as
  pending rows (probably admin-entered on a coach's behalf) rather than through
  `events`/`event_assignments` at all. **Not designed in detail yet — scoped as a separate, later
  piece of work**, not bundled into "the same importer" the way it first sounded.

---

## Pay-period logging windows & payment claims queue (✅ done, deployed 2026-09-27)

Extends the same "small/routine stays fast, anything else gets reviewed" principle already built
into `oversight_approvals` and `swap_requests` to session logging generally: coaches can only
self-service log what's genuinely current; anything older, unverifiable, or claiming an assignment
they weren't given routes through `payment_claims` for admin review instead. Scoped in a claude.ai
planning session, corrected against the actual codebase in Claude Code before being recorded, then
built and verified end-to-end against the real Supabase project before shipping.

**`pay_periods`**: admin-managed start/end date rows (`/pay-periods`, modeled on the `events`
admin CRUD pattern). Band boundaries are computed **client-side** (`src/utils/payPeriods.ts`) by
**row position**, not elapsed days — "current period" is the most recent row whose `start_date`
has passed, counting back from there — so editing dates later doesn't reshuffle bands relative to
a hardcoded interval, and an admin running a few days behind on creating the next period doesn't
strand today's date with no current period at all. With fewer than 4 periods defined, or before
any period has started, everything falls through to the fully-reviewed Band C path rather than the
app guessing — **this table needs real rows before the banding behavior does anything meaningful**
(with none configured, every date classifies as Band C).

**Three bands, `/log-session`** (gates only the `session`-entry_mode flow — `direct_time`/
`direct_flat`/reimbursement are unaffected by band, in every band, since they have no calendar
counterpart to be ambiguous against):
- **Band A** (current period + 1 back): the normal picker, gained two new filters — excludes
  events already paid for, and (a correction to this feature's own initial assumption: the picker
  had **zero** coach-assignment filtering before this, confirmed by reading the code, not "already
  true today" as first assumed) now restricted to events this coach is actually assigned to. This
  is a real, deliberate behavior change beyond just adding the new bands, made specifically so
  "Don't see something you coached?" (below) isn't pointless — without it, a coach could just log
  an unassigned event the normal way with no review at all.
- **Band B** (periods 3–4 back): "late request" — same cascading picker, unfiltered by assignment,
  but submits a `late_event` claim instead of logging directly.
- **Band C** (older): no event picker — a structured form (program/location/reason
  category/notes) submitting an `unstructured` claim, `event_id` null.

**"Don't see something you coached?"** (`/my-sessions/unassigned-claim`): Band-A-scoped event
picker, unfiltered by assignment, for flagging an event you weren't listed on (or nobody was) —
submits an `unassigned_claim`. Deliberately did not touch the existing "Other (not on the
calendar)" hatch or Reconciliation's existing mismatch flagging — both already cover adjacent
cases and needed no changes.

**"Confirm hours" needed zero code changes** — verified directly before building anything: it
already inserted straight from the event's scheduled start/end via the existing
`resolveEventHours`/`timeSpanHours` logic (now lifted out to `src/utils/hours.ts` since correction
requests and admin claim-approval both need the same functions), with no coach-editable time
fields anywhere in that path. It was already a pure confirm.

**Self-edit lockdown — the real gap, more specific than it first sounded**: the actual bypass
wasn't "hours/time fields are directly editable" on a session-linked pending entry (they weren't).
It was that switching **Location to "Other (not on the calendar)"** mid-edit re-routed the whole
entry around its event link entirely, swapping in free-form time inputs RLS already permitted the
coach to save with zero review. Fixed by rendering session-linked pending entries as a read-only
summary in edit mode (structurally unreachable to that Location switch) with a link to "Request a
correction" instead — not by patching the two fields that didn't exist for that path anyway.

**"Request a correction"** (`/log-session/correct/:eventId`): proposed hours (time-span
`TimePicker`s for regular programs, a plain hours `InputNumber` for Camp/Nurse fixed-hours
programs, since they have no time span to propose) + required reason, always reviewed regardless
of size — no tolerance threshold of any kind. Works both pre- and post-"Confirm hours" (`entry_id`
null vs. set on the claim, so admin approval knows whether to insert a new entry or update the
existing one). **Resubmitting while a correction is already pending updates that claim in place**
rather than trying to insert a second one — caught during manual testing when a real duplicate
attempt hit the partial unique index and just failed with no path forward; fixed same session.

**`payment_claims` gained two columns beyond the version scoped in chat** (both necessary to make
that version's own requirements representable, not scope creep): `entry_id` (so an approved
`hours_correction` claim updates the exact entry it's correcting rather than re-deriving one from
`(coach_id, event_id)`, which is ambiguous if the coach deletes/re-logs in between) and `notes`
(Band C's form needs both a fixed reason-category dropdown and free-text elaboration; `reason`
alone couldn't hold both).

**Admin review** (`/reconciliation`, new "Payment claims" card, filterable by type): `late_event`
and `unassigned_claim` approve identically (insert a normal entry from the event +
`resolveEventHours` — they only differ in *why* the claim exists). `unstructured` approval needs a
small modal prompting for hand-entered hours first, since there's no event to derive them from
(mirrors the plain hours `InputNumber` already on the generic admin Timesheet Entries edit screen).
`hours_correction` approval updates the linked entry (or inserts one, pre-confirm case) with the
requested hours; denial changes nothing. RLS gives coaches both insert and select on their own
claims (not insert-only), so a denial is actually visible to them — the same asymmetry gap caught
and fixed on `swap_requests` last time, not reintroduced here.

---

## Native bulk importer (✅ done, deployed 2026-09-27)

The Sprocket CSV importer isn't a general-purpose uploader — it's a translator for one vendor's
export, and that export has a real, unfixable gap: coach assignment only ever gets parsed for
Camp rows, because Sprocket only encodes staffing via a Camp-specific `" - Director"`/
`" - Counselor"` Title-suffix convention (confirmed directly against `parseSprocketCsv.ts` while
diagnosing a hand-built Town Sessions test file — the coach-name extraction and multi-row
grouping logic are both hard-gated on that suffix, not just conventionally Camp-flavored). Town
Sessions and every other program never carry a parseable coach, and that data was never in
Sprocket's export to begin with — no parser fix closes that gap. `/bulk-import` is the fix: a
format this app defines itself, going straight into `events`/`event_assignments`, additive to the
Sprocket importer (which is untouched — not a single line of `sprocket-import/index.tsx` or
`parseSprocketCsv.ts` changed).

**Format** (`src/utility/parseBulkImportCsv.ts`): `Program`, `Location`, `Date` (`YYYY-MM-DD`,
chosen specifically to avoid Sprocket's `M/D/YYYY` ambiguity), `Start Time`/`End Time` (`HH:mm`
24-hour, matching the admin-facing `TimePicker` convention used elsewhere — coach-facing screens
use `h:mm A` instead), `Session Name` (optional), `Coaches` (semicolon-separated). One row is
always one event — the whole point of this format is that `Coaches` supports multiple names
natively, so none of Sprocket's row-collapsing/role-suffix grouping logic exists here at all. No
`IsCancelled` column (deliberate): this format is for entering new schedule data; cancelling an
existing event is naturally an edit-time action elsewhere, not something to bulk-declare at
creation. No Camp half/full-day auto-resolution either — an admin importing a Camp session via
this format specifies the real fixed-hours program (e.g. `Camp-Full Day`) directly, no
vendor-specific guessing.

**Separate page, not a mode on `/sprocket-import`** — confirmed by reading the existing importer's
629 lines in full before deciding: it's one monolithic component, and almost nothing in it is
factored for reuse. The only genuinely format-agnostic pieces are the `IGNORE`/`IGNORE_OPTION`
sentinel and the localStorage remembered-mappings mechanism (both pulled out into a new
`src/utility/importMappingStorage.ts`, parameterized by storage key, used only by the new
importer — Sprocket's file keeps its own inline copy). Everything else — `LocationBlock`,
`groupEventsByLocationBlock`, `resolveCampDayType`, the Camp half/full-day branch, the dated
camp-location-block splitting — exists specifically to solve Sprocket-shaped problems this format
doesn't have. A mode toggle would have meant heavy conditional branching for no real sharing
benefit, and risked the existing (explicitly "leave untouched") tool.

**Unmatched coaches block import — deliberately diverging from Sprocket's behavior.** Sprocket's
importer lets an unmatched coach name through silently (the event still gets created, that one
assignment is just skipped and counted). Here, every distinct coach name across the file must be
either a real `coaches.name` match or an explicit `"Leave unassigned"` sentinel before the Confirm
button unlocks — same blocking treatment as Programs/Locations, just with a third option instead
of only two, since "the gate is *you haven't decided*, not *a match is mandatory*." No
auto-create of coach records from unmatched names, ever — a typo should surface to a human, not
silently create a ghost coach. Verified in isolation (not just as part of a larger resolved/
unresolved mix): a single-row file with an already-auto-resolved Program and Location and only an
unmatched coach name keeps the Confirm button `disabled: true`; selecting "Leave unassigned"
flips it to `false` with nothing else touched.

**Intra-file duplicate-row warning** — new, and not something Sprocket's importer needs. Two rows
in the *same upload* sharing identical Program/Location/Date/Time/Session Name but different
`Coaches` (e.g. a CSV author reverting to one-row-per-coach out of old Sprocket habit) would
otherwise import the first row, then silently get skipped as "already exists" on the second —
dropping that second row's coaches with no warning, since the in-memory dedup signature is added
after the first insert. Sprocket never needs this check because its Camp grouping merges by
design; this format has no such merging, so a same-file duplicate is always a mistake, and blocks
Confirm (not just a warning) until the file is fixed. Verified directly: two rows differing only
in `Coaches` produced a "Duplicate rows found in this file" alert naming both row numbers, and
Confirm stayed locked even after every other mapping was separately resolved.

**Duplicate handling against the database** reuses Sprocket's exact signature shape
(`[program_id, location_id, event_date, start_time, end_time, session_name].join('|')`) unchanged,
since both importers write to the same `events` table — a useful side effect is that the two
importers naturally dedupe against each other, not just against themselves.

**RLS — confirmed, zero changes needed.** Read `0004_phase2_schema.sql`, `0005_...`, `0006_...`,
and `0011_coach_confirm.sql` in full before building: `events` already restricts INSERT/UPDATE/
DELETE to `is_admin()`, and `event_assignments` has **no coach-facing INSERT/DELETE policy at
all** — only an admin `for all` policy, a coach read-only self-select, and a coach column-scoped
update limited to `coach_confirmed_at`. That already fully satisfies "admin-only write path, no
new coach-facing surface" — the new page just needed to live under `AdminRoutes` like
`/sprocket-import` does. No migration, no RLS change, for this entire feature.

---

## Payroll lessons (Oct 2026) — R1–R9

Justin ran the Sep 1 – Oct 6, 2026 payroll on the old Sheets system and wrote up what it surfaced
as nine requirements (R1 cutover, R2 on-the-fly schedule changes with a scheduler role/history/
review queue, R3 paid-time rules for AP +15 min and game warm-ups, R4 entry Hold/Canceled/Not Next
Step statuses with admin→coach questions, R5 double-pay flag on covered sessions, R6 whole-day
cancellations, R7 weekly-rate coaches, R8 rate history + paid-at amounts + adjustments, R9 AP
attendance from Luis). Assessed against the code on 2026-10-12. Findings that the requirements
doc didn't know about, worth remembering when building the rest:

- **Payment Due ignores Reconciliation entirely.** Cancelled events, "Other (not on the calendar)"
  entries (straight to pending, flagged `missing_event` in Reconciliation only), and anything else
  Reconciliation flags are still paid by default. R2's payroll gate, R4's Hold, and R6's
  cancelled-not-paid all need the same thing — **build one shared "payable" predicate** in
  `src/utility/payrollFilters.ts` (where `isPreCutoverExcluded` already lives) rather than three
  separate filters.
- ~~**Paid history is recomputed from current rates.**~~ Fixed by R8 (minimal), 2026-10-13 — paid
  entries now carry their own saved amount.
- ~~**The Coaching-rate fallback is silent**~~ — fixed in R8 (minimal): an orange "Coaching rate"
  tag in Payment Due, and `paid_rate_basis = 'coaching_fallback'` saved on the entry.
- **Sprocket's `ArrivalTime` column isn't parsed at all** (R3).
- Schedule Board and swap approval **delete** `event_assignments` rows — no history survives (R2).

### Done: Payment Due date range + R1 cutover (2026-10-12, migrations `0015_cutover.sql` + `0016_cutover_resolution.sql`)

**The bug fixed first:** Payment Due had no date range — it loaded every pending entry, and "Mark
all paid" marked all of a coach's pending entries — while the Zoho export *was* date-ranged and
told you to go mark entries paid on Payment Due afterward. Exporting Sep 1–Oct 6 and then clicking
"Mark all paid" would have marked Oct 7+ entries paid that were never exported.

- **Shared range** (`usePayrollRange` in `src/utility/payrollFilters.ts`), carried in the URL
  (`?from=&to=`) so Payment Due ↔ Zoho export links keep the same payroll run. Default is
  "since last payroll": the day after `app_settings.paid_through_date` through today. **Not**
  "day after the latest `paid_date`" — paid_date is when you clicked, not the period end, so that
  would skip sessions between period end and payroll day.
- **`paid_through_date` advances automatically only once every payable entry in the range is
  paid**, never backwards. A coach held back (e.g. missing rate) keeps it from advancing, so their
  entries can't fall out of the next default range. Warnings show counts of pending entries
  before/after the range, with an "Include them" button for the earlier ones.
- "Mark all paid" now confirms with the date range and total first.
- Pending tab fetches all pending entries and partitions client-side (so out-of-range and
  pre-cutover counts are visible); Paid history is range-filtered server-side since it grows.

**Cutover** — `app_settings` (single row, `id = 1`): `cutover_date` (2026-10-07) and
`paid_through_date`. Editable on `/settings`. Kept separate from `pay_periods` deliberately: band
math counts periods by row position, so "cutover = first pay_periods row" would silently move if
an earlier period were ever added.

- **Enforced in RLS, not just the UI** — the first time a coach-facing date rule is. New
  `coach_date_allowed(d)`: `d >= cutover_date()` and `d <= today in America/New_York` (explicit
  timezone — `current_date` is UTC and runs a day ahead every evening). Applied to coach
  insert/update on `timesheet_entries` and coach insert on `payment_claims` (via
  `claim_date(event_id, approx_date)`). This also closes logging in advance (Prince/Milo) at the
  DB level, and covers Office Hours/1v1/reimbursements, which have no band limits at all. Coach
  *delete* of pending entries was left unrestricted (deleting can't cause a payment).
- **`timesheet_entries.admin_entered`** — provenance, the "unless Justin enters it" exception.
  Set by a `before insert or update` trigger from `is_admin()` on insert, never trusted from the
  client, and **immutable afterward for everyone, admins included** (0016 — 0015 originally let
  an admin flip it, which mixed "who entered this" with "what did we decide"). Existing rows
  backfilled `false`. Admin-approved claims count as admin-entered: approval inserts the entry
  while an admin is logged in. A `hours_correction` approval that *updates* a coach's existing
  entry keeps the coach's `false` — correct, since claims can't be pre-cutover anyway.
- **`timesheet_entries.cutover_resolution`** (0016) — the per-entry decision on a pre-cutover
  pending entry: `paid_in_sheets` (a distinct marker, not just ordinary `paid`; the trigger also
  forces `status = 'paid'`, `paid_date = null` so every existing "already paid" check still
  applies) or `still_owed` (Sheets never paid it — payable here). Admin-only (trigger reverts a
  coach's change), and the trigger **raises** if it's set on an entry dated on/after cutover.
  Payment Due and the Zoho export exclude `entry_date < cutover and not admin_entered and
  cutover_resolution is distinct from 'still_owed'`.
- **Cleanup card** on Payment Due lists each undecided pending pre-cutover entry with its own
  "Paid in Sheets" / "Still owed" buttons (Popconfirm each) — deliberately no bulk select, since
  some September sessions were paid in Sheets and some weren't. The update also filters
  `.lt('entry_date', cutover)`; "Mark all paid" likewise filters to the selected range and
  `status = 'pending'` server-side, on top of the client-side partition. "Paid in Sheets" shows
  as "Old system" in coach Paid history and a purple tag on the admin entries list. At build time
  the only pre-cutover pending entries were 7 July TEST COACH entries.
- **Tests** — first in the repo: Vitest (`npm test`), `src/utility/payrollFilters.test.ts`.
  The partition logic was pulled out of Payment Due into `partitionPendingEntries` so it's
  testable: the cleanup bucket never contains a post-cutover entry under any flag combination,
  and the payable bucket ("Mark all paid" scope) is exactly the selected range, boundaries
  inclusive, every entry in exactly one bucket. Not wired into the GitHub Actions deploy.
- Coach UI mirrors it: every date picker blocks pre-cutover dates; edit/confirm/correct on a
  pre-cutover session shows a "handled in the old system" notice instead of a form; My Sessions'
  "Not yet logged" skips pre-cutover assignments; the unassigned-claim window starts at cutover.
- **New `/entries/create`** admin screen (hours or flat amount required).
- **Fixed in passing:** `0014` never gave coaches an UPDATE policy on `payment_claims`, so
  "resubmitting a pending correction updates it in place" (log-session.tsx) matched zero rows and
  silently did nothing while showing success. `0015` adds one (own, still-pending claims only;
  `with check` keeps status `pending`, so a coach can't decide their own claim). Not live-tested
  end-to-end — doing so would have left a test claim in the admin queue.

Verified against the real project 2026-10-12: as a coach, raw REST inserts dated 9/15 and
tomorrow were rejected by RLS, 10/8 accepted with `admin_entered = false`; forging
`admin_entered = true` was silently reverted by the trigger; moving an entry to 9/15 and a 9/15
`unstructured` claim were both rejected; the coach date picker enabled exactly 10/7–today. As
admin, a 9/15 admin-entered entry appeared in Payment Due only when the range included it; "Mark
all paid" over 10/7–10/10 paid only the 10/8 entry, left 9/15 pending, and advanced paid-through
to 10/10 (then reset to 10/6 and test rows deleted).

### R2 — on-the-fly schedule changes (plan agreed 2026-10-12)

Four stages, each verified before the next: **R2a** roles, **R2b** logged quick actions,
**R2c** review queue + payroll hold, **R2d** swap-with-replacement + Sprocket source tagging.

Decisions made with Justin:
- **Scheduler scope** = two kinds of rule, either matching is enough: *program and/or location*
  (e.g. Town Session at each Natick location — one row per location; a town/area grouping was
  considered and deferred until location lists get long), and *coach* (manages any event that
  coach is assigned to, anywhere). Not a coach *pool* restricting who they can assign.
- **Schedulers can create events**, but only via a program/location rule, not a coach rule.
- **Sprocket re-import policy changed** from the earlier "Sprocket wins, straight overwrite" (in
  "Where things stand right now" above): **Sprocket wins only for Sprocket-sourced
  assignments**; manual/bulk ones are kept and conflicts listed for Justin. Recorded now, built
  with the (still template-blocked) importer upgrade. Note the importer today skips existing
  events entirely, so it can't erase a manual sub yet — its real current gap is duplicating an
  event whose time changed in Sprocket.
- **"Scheduler changes wait for approval" switch deferred**; R2b change rows will store enough to
  apply later if it's ever wanted.
- History will live in an append-only `schedule_changes` table, with `event_assignments` staying
  current-state only — so the 6+ existing readers (My Sessions, Band A picker, Reconciliation,
  board, claims) don't each need a "skip removed rows" filter. All writes go through
  security-definer functions so a change can't happen without its log row.

**R2a done (2026-10-12, `0017_roles.sql`):**
- **Admin is now an allowlist** (`admins`, seeded `jschupp@next-step-training.com`). Before this,
  `is_admin()` was "signed in and not on the coach roster" — combined with magic-link sign-ups
  being enabled, any stranger could self-register as a full admin. Sign-ups were also turned off
  in Supabase Auth the same day. Add an admin: `insert into admins (email) values ('…')`
  (lowercase enforced by a check constraint).
- `schedulers` + `scheduler_scopes` (check constraint: a row is either program/location or
  coach), `current_scheduler_id()`, `is_scheduler_for_event(event_id)`,
  `is_scheduler_for_program_location()` (for R2b's create), and an `in_my_scope` computed column
  on `events` so the UI filters with the same check RLS uses. Schedulers get **read-only**
  in-scope `event_assignments`; no write access to anything until R2b.
- `getIdentity` now resolves roles from the DB (`rpc('is_admin')`, schedulers, coaches) — admin >
  scheduler > coach > `none`. A scheduler who is also a coach (same email in both tables) gets
  the coach screens too (`coachIdOf()` in authProvider). A login on no roster gets a "no access"
  screen instead of the admin UI. Schedulers get a phone-first `/schedule` day list (read-only);
  admins get `/schedulers` with a scope-rule editor.
- Coach emails entered on the Coaches screens are now lowercased on save — Auth stores login
  emails lowercase and `current_coach_id()` matches exactly, so a capitalized roster email could
  never log in.
- Added locations Natick - Bennett-Hemenway and Natick - Sargent 9v9 (Justin's request).
- Verified live as a test scheduler (`schupp.14+scheduler@gmail.com`, scoped to Town Session at
  the 5 Natick locations): routed to `/schedule` with no admin/coach screens; saw a Natick test
  event and its assignment, not an AP one (its event row is readable — events always were — but
  not who's on it); 0 rows readable from rates, 1v1 rates, entries, claims, swaps, admins,
  oversight; updates to events/assignments/settings/rates matched 0 rows, and inserts into
  events, assignments, admins, own scopes, and entries were refused by RLS. Adding a TEST COACH
  coach rule (via SQL) brought the AP test event into scope. **Test scheduler, its Natick rules,
  and two "R2A TEST" events are intentionally left in place for R2b testing — delete at the end
  of R2.**
- Gotcha: a magic link lands on the deployed site (Supabase's redirect), not localhost — testing
  undeployed UI as another role means carrying that session over to the dev server.
- Go-live (separate step, per Justin): locations, fall events via bulk import, coach logins,
  SMTP — and **reset the cutover date to the go-live date, with Paid through set to the day
  before**, in Settings.

**Access audit + read tightening (2026-10-12, `0018_tighten_reads.sql`, `0019_grant_hygiene.sql`):**
Done before R2b gives schedulers write access. Audited against a live dump of `pg_policies` and
grants (no drift from the migration files was found).
- `coaches` had been readable in full by any signed-in user since Phase 2 — every coach and
  scheduler could read every coach's `email` and `pay_type`. Now: admins read all rows, a coach
  reads only their own. Non-admin screens get names from the **`coach_directory` view** (id, name,
  initials, is_active): admins and schedulers see everyone, a coach only themselves, anon nothing.
  It's a non-`security_invoker` view (bypasses `coaches` RLS; its own WHERE restricts), which
  Supabase's Security Advisor reports as an ERROR-level `security_definer_view` — **expected and
  accepted**; it was the only advisor finding. Embed it with an alias to keep shapes:
  `coaches:coach_directory(name)`.
- Reference tables (programs, locations, events, pay_periods, app_settings) changed from
  "anyone signed in" to `has_app_role()` (admin, scheduler, or coach) — a login on no roster now
  reads nothing.
- `anon` holds no table privileges and can't execute our functions (Postgres grants EXECUTE to
  PUBLIC by default; revoked by name, granted to `authenticated`).
- `authenticated` lost TRUNCATE/TRIGGER/REFERENCES everywhere (TRUNCATE bypasses RLS; not
  reachable via PostgREST, but nothing needs it).
- Who can read/write what, as of 0019: reference tables — everyone with a role reads, admin
  writes; `coaches` — admin all, coach own row; rates/1v1 rates/oversight/admins — admin only;
  entries/claims/swaps — admin all, coach own rows only (writes as described in earlier
  sections); `event_assignments` — admin all, scheduler in-scope read, coach own read +
  `coach_confirmed_at` update; schedulers/scopes — admin all, scheduler own read.
- Verified live as anon (every table/view/function: permission denied), scheduler (0 coaches
  rows, directory names-only, `email` column doesn't exist on it), TEST COACH (own coach row and
  own name only; 0 rows of another coach's entry/claim/swap created for the test; 0 rates), and
  admin (full counts; Coaches, Payment Due, Zoho, Reconciliation, Board, Schedulers, Entries,
  Events, Rates, Settings all load with no failed requests).
- ~~**Open question for Justin:** should a deactivated coach still sign in?~~ **Decided
  2026-10-13:** yes, read-only — they keep sign-in and history, but RLS refuses their writes
  (`coach_is_active()`, done in R3's `0023`).

**R2b done (2026-10-12, `0020_schedule_changes.sql`, `0021_create_event_check_order.sql`):**
- `schedule_changes`: append-only history (create/sub/add/remove/time/cancel/restore, removed/added
  coach, old/new times, required reason, who/role/when, `review_status`). No API writes at all —
  only the functions below insert. Admins read all; schedulers read in-scope events' rows (plus
  their own); coaches read none. `on delete cascade` from events so admin event deletes still work.
- `event_assignments` gained `source` (`sprocket`/`bulk`/`manual`/`legacy` — the 238 rows that
  existed before were all set `legacy`, origin unknowable; the importer upgrade must treat
  `legacy` like `manual`) and `covering_for_coach_id` (set by a sub; R5 reads it). Importers now
  tag `sprocket`/`bulk`.
  **Gotcha:** two FKs from `event_assignments` to `coaches` now exist, so any embed of coaches
  through assignments must name the FK: `coaches!event_assignments_coach_id_fkey(name)` (or
  `coaches:coach_directory!event_assignments_coach_id_fkey(name)`), else PostgREST errors with an
  ambiguous-relationship error.
- Functions (security definer; each checks permission FIRST, then reason, then applies + logs in
  one transaction; return the batch id): `schedule_sub`, `schedule_add`, `schedule_remove`,
  `schedule_change_time` (optionally this + later events in the series — all-or-nothing for a
  scheduler, refusing with "you manage N of M…"), `schedule_set_cancelled` (single event; whole-day
  + timing is R6), `schedule_create_event` (scheduler needs a program/location rule). Refusals
  raise errcode 42501 (PostgREST 403) with person-readable text: "Not allowed: you don't manage
  this event." / "Not allowed: coaches can't change the schedule…" / "Not allowed: you can't
  create events for this program at this location." Validation errors are 400 with plain text.
  Scheduler changes → `needs_review`; admin changes → `reviewed`. Helpers (`schedule_log`,
  `schedule_assert_can_change`, …) aren't executable by anyone via the API.
- A trigger on `events` logs time/cancel edits made directly (the admin Edit Event form) as admin
  changes ("Edited on the Events screen"), skipped when a function already logged it (via the
  transaction-local `app.schedule_change_logged` setting) and for SQL-Editor edits (no
  `auth.uid()`).
- UI: `useScheduleAction()` (`src/utility/scheduleActions.ts`) is the only way the UI calls these
  — it always shows the database's error text. Phone-friendly event page (`/schedule/event/:id`
  for schedulers, `/schedule-board/event/:id` for admins) with Sub/Remove per coach, Add, Change
  time (+series), Cancel/Restore, and the history ("Pat covered for Keith", needs-review tag, who,
  when, reason). Scheduler schedule rows link to it; "New session" modal offers only creatable
  program/location pairs. Admin board picker now requires a reason and saves via
  `schedule_add`/`schedule_remove`, with an "Open event" link for subs/time/cancel. Swap approval
  removes via `schedule_remove` (logged).
- Verified live 2026-10-12: as TEST COACH every function → 403 coach message (incl. blank
  reason, after 0021), direct inserts into `schedule_changes` and calling `schedule_log` denied;
  as admin the board add, Events-form trigger, and swap approval all logged as `reviewed`; as the
  test scheduler a UI sub on a Natick event worked (history shows "covered for", needs review),
  the out-of-scope AP event showed the red "Not allowed: you don't manage this event." toast
  on screen with the dialog left open, all five actions + blank-reason call on it → 403 with the
  event unchanged, create at AP/Franklin → 403, create at Natick → OK, mixed-scope series → 403
  with nothing changed, in-scope series → both dates moved, removing TEST COACH from a session
  they'd already confirmed → assignment gone, **entry kept**; back as TEST COACH the subbed-out
  session vanished from My Sessions and the confirmed entry remained pending. Not seen on screen:
  the sub (Aimee) has no login, so "sub sees it" is verified only as her assignment row existing.
- The "sub sees it" gap above was closed in R2c: real coaches (Aimee, Alex) were scrubbed from the
  test data via SQL and replaced with a second test login, **TEST COACH 2**
  (`schupp.14+coach@gmail.com`, roster initials TC2).

**R2c done (2026-10-12, `0022_schedule_review.sql`):**
- `schedule_mark_reviewed(ids)` and `schedule_reverse(id, reason)` — admin-only (anyone else gets
  403 "Not allowed: only an admin can review/reverse schedule changes."). Reverse applies the
  inverse as new admin-logged changes ("Reversed: …"), marks the original `reversed`, and
  **refuses rather than clobbering** if the schedule moved on since (sub/added coach no longer
  there, removed coach already back, time changed again — "Reverse the later change first",
  already cancelled/active). Reversing a `create` cancels the event (entries may point at it).
- **Payroll hold**: an entry is held while its event has any `needs_review` change. Computed in
  the shared `partitionPendingEntries(..., heldEventIds)` (new `held` bucket; `useHeldEventIds()`
  in `payrollFilters.ts`), so Payment Due and the Zoho export agree. Payment Due shows a "held for
  schedule review" warning listing them; "Mark all paid" also filters held events server-side
  (keeping `event_id IS NULL` off-calendar entries eligible); `paid_through_date` won't advance
  while held entries in the range are unpaid. Out-of-range/pre-cutover entries keep their buckets.
- Reconciliation → **"Schedule changes to review"** card (`ScheduleChangesCard.tsx`): grouped by
  event, Mark reviewed / Reverse (reason required) per change, Mark all reviewed per event, and the
  event's entries with flags: taken off the session after logging (kept; edit/delete in Timesheet
  Entries), already paid (no clawback), recorded hours ≠ session's current worth after a time
  change (pending → one-click "Update to N hrs" via `resolveEventHours`; paid → no clawback),
  cancelled-with-hours (decision deferred to R6).
- Verified live 2026-10-12: as the scheduler, a sub TEST COACH → TEST COACH 2 and a time change on
  the Oct 9 session (whose entry was already confirmed); review/reverse → 403. As TEST COACH 2
  (on the deployed site) the session appeared under Upcoming immediately; as TEST COACH it was
  gone while the Oct 9 entry stayed pending. As admin: Payment Due (Oct 7–12) listed the Oct 9
  entry as held and excluded it, Zoho excluded it; the queue showed both flags; "Update to 1.50
  hrs" set the entry to 1.50 (5:00–6:30); reversing the TEST COACH 2 sub restored TEST COACH
  (logged as admin remove+add, original marked reversed); reversing a time change after a newer
  admin change showed "Can't reverse: the time was changed again since…" on screen; "Mark all
  reviewed" released the entry into Payment Due (TEST COACH 1.50 hrs, "No rate" — no Town
  Session rate on file) and into Zoho's missing-rate list.
- 23 unit tests (`npm test`), incl. 4 for the hold.
- Test data (TEST SCHEDULER, TEST COACH 2, "R2A/R2B TEST" events and everything on them) was
  removed at the end of R2 — see below.

**R2d done (2026-10-13, no migration):**
- Swap approval (Reconciliation → Swap requests → "Approve…") opens a dialog with an optional
  replacement coach. With one, approval runs `schedule_sub` (replacement assigned, marked
  `covering_for_coach_id` = requester, one logged admin change, already reviewed); without one,
  the plain logged `schedule_remove` from R2b and the session is left unfilled.
- Source tagging (`sprocket`/`bulk`/`manual`/`legacy`) and the revised Sprocket re-import policy
  were already done in R2b; the importer upgrade that *uses* them is still blocked on Sprocket's
  bulk-import template.
- Verified live: an admin-filed swap request for TEST COACH on a Natick test session, approved
  with TEST COACH 2 as replacement → request approved, TEST COACH 2 assigned covering for TEST
  COACH, history row "sub — Swap request approved: …" (admin, reviewed).
- Found while checking test data: TEST COACH carried a $100/hr Camp-Full Day rate (from earlier
  testing), which would have made its two July Camp-Full Day test entries payable ($600 each) if
  ever marked "Still owed". The end-of-R2 cleanup deletes all TEST COACH rates and deactivates
  TEST COACH (kept as Justin's standing test login — sign-in ignores `is_active`; see the open
  question above), and deletes TEST COACH 2, the test scheduler, and all "R2A/R2B TEST" data.

**R2 closed (2026-10-13).** Cleanup SQL run by Justin; verification query showed 0 test events, 0
`schedule_changes` rows, 0 test-coach assignments/rates/1v1 rates, 0 schedulers, and 7 remaining
TEST COACH entries (its July pre-cutover test entries — to be marked "Paid in Sheets" on Payment
Due). TEST COACH is now `is_active = false` with no rates (still signs in, since
`current_coach_id()` ignores `is_active`). The `+scheduler`/`+coach` Auth users are deleted by
hand in Authentication → Users. The two Natick locations added during R2a (Bennett-Hemenway,
Sargent 9v9) are real data and were kept.

### Done: R3 paid-time rules + inactive-coach lockout (2026-10-13, `0023_paid_time.sql`)

- **Paid start = scheduled start − N minutes; paid end = scheduled end.** N = the event's
  `paid_early_minutes` override, else the program's `paid_early_minutes`, else 0; ignored for
  Camp/Nurse fixed-hours programs. Stored as minutes, not a clock time, so a schedule time change
  carries the paid window along. "Annual Program" (the only AP-named program) = 15; every other
  program 0. Editable on the Programs screen (program rule) and Edit Event (per-event override,
  blank = use the program's).
- `src/utils/hours.ts`: `paidWindow()` / `paidEarlyMinutes()`; `resolveEventHours()` now takes the
  **program record**, not its name, so a call site can't silently drop the offset (all 5 call
  sites — log/confirm, correction, claim approval, review-queue stale check — were caught by the
  type check). **Entries now record the paid window** (e.g. 17:15–18:30 for a 5:30 AP session) so
  start/end agree with hours. Coach sees "Paid 5:15 PM – 6:30 PM (includes 15 min before the
  start)". Correction proposals default to the paid window. Existing entries were not recomputed.
- **Sprocket import:** `ArrivalTime` is filled on 233/239 rows of the July export (5 min before
  camps, 10–15 before AP practices), so it is **not** a game signal by itself. The parser sets
  the event override (start − arrival) **only on rows with `ClubEventType = 'Game'`**
  (`gameWarmupMinutes()`); AP's 15 comes from the program rule, not ArrivalTime (some AP rows say
  10). **Unconfirmed:** no export in hand contains a game, so the exact `ClubEventType` value for
  games still needs checking against a fall export.
- **Bulk import:** optional `Arrival Time` column (HH:mm, must be before Start Time; otherwise the
  row is rejected with a message).
- **Inactive coaches** (Justin, 2026-10-13): `coach_is_active()` added to the coach
  insert/update policies on `timesheet_entries` and `payment_claims` and the insert policy on
  `swap_requests`. They can still sign in, read their history, and delete their own pending
  entries (not asked to block). UI: `isInactiveCoach()` in authProvider → banner in the coach
  layout, and Log a Session shows a notice instead of the form.
- Tests: 37 (`npm test`) — paid-time cases, Sprocket game detection incl. a check against the real
  July export (no practice row gets warm-up), bulk Arrival Time parsing.
- Verified live: as inactive TEST COACH, inserts into entries/claims/swaps → 403, history still
  readable, banner + notice shown. As admin: Programs shows AP 15; a 30-min warm-up saved through
  Edit Event (no stray `schedule_changes` rows). As (temporarily reactivated) TEST COACH, Confirm
  hours on three Oct 12 test sessions: AP 5:30–6:30 → **1.25** (entry 17:15–18:30), game 10:00–11:00
  with 30-min warm-up → **1.50** (09:30–11:00), Town Session practice 5:00–6:00 → **1.00**. Needed a
  temporary Oct 5–18 pay period (the table is empty — see the go-live list).

### Done: R8 minimal — paid rate/amount saved at payment (2026-10-13, `0024_paid_amounts.sql`)

- `timesheet_entries` gained `paid_rate` (hourly; null for flat/1v1), `paid_amount`, and
  `paid_rate_basis` (`exact` / `coaching_fallback` / `flat` / `one_v_one` / `manual`). Entries paid
  before this have none of them and show **"Not recorded"** — never a recomputed guess.
- **Database rule** (`require_paid_amount` trigger): an entry can't become `paid` without
  `paid_amount`, except `cutover_resolution = 'paid_in_sheets'`. Legacy paid rows without an
  amount aren't touched, but an amount, once recorded, can't be removed.
- **`mark_entries_paid(rows, paid_date, range_start, range_end)`** — admin-only, all-or-nothing:
  every row must still be pending, inside the range, not held for schedule review, and carry an
  amount, else nothing changes and the count is reported. Payment Due's "Mark all paid" is the
  only caller; it sends each entry's rate/amount/basis from `computeAmount`, i.e. exactly the
  numbers on screen.
- `computeAmount` (`src/utility/payroll.ts`) now also returns `rate` and `basis`; an entry with no
  hours and no flat amount is now **missing** (blocks payment) rather than a silent $0.
- Payment Due: orange **"Coaching rate"** tag wherever the fallback applies (pending and paid);
  Paid history shows saved amounts only. Coach Paid history shows **rate and amount** (Justin:
  coaches see both on their own paid entries). Admin **Edit Entry**: Status = Paid reveals Paid
  rate / Paid amount, pre-filled from the lookup (and today's paid date if empty); amount always
  required, rate only for hourly entries; changing the amount saves basis `manual` ("Set by
  admin"); Paid in Sheets entries need neither.
- **Bug fixed in passing:** Edit Entry's inline `queryOptions.select` was re-run every render,
  which made Refine reset the form — so any edit was wiped the moment something re-rendered it
  (here, Status → Paid snapped back to Pending). Hoisted to a module-level `toFormValues`.
  **Same pattern exists in other edit screens** (events, pay periods, settings); harmless today
  only because nothing else re-renders them mid-edit.
- **Known gap (rest of R8):** the Zoho export still prices pending entries from current rates at
  export time; if a rate changes between export and "Mark all paid" they can differ. Rate
  effective dates and dollar adjustments are also still to do.
- Tests: 42 (`npm test`), incl. 5 for `computeAmount` basis/rate/rounding.
- Verified live 2026-10-13 (admin, temporary TEST COACH rates Town $60 / Coaching $40): a direct
  "set paid" with no amount → refused; `mark_entries_paid` with one out-of-range row → refused,
  nothing changed; Payment Due showed Futsal $40 with the "Coaching rate" tag; Mark all paid saved
  Town 1.5h → $90 `exact`, Futsal 1h → $40 `coaching_fallback`, Reimbursement → $25 `flat`; raising
  the Town rate to $70 left Paid history at $90; Edit Entry pre-filled $70 / $140 for a 2h entry,
  and overriding to $130 saved basis `manual`. Test entries/rates deleted, paid-through reset to
  Oct 6. **Not seen on screen:** the coach Paid history columns (TEST COACH had no paid entries
  left to show).
