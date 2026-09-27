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
  what coaches pick from instead of typing times. Admin CRUD only so far — no write path yet for
  Sprocket to populate this other than the one-way CSV importer
- `event_assignments` — new table, not in the original plan: which coach(es) are actually
  scheduled to work a given event. Populated by the Sprocket importer or by hand via the admin
  Schedule Board (`/schedule-board`, added in the scheduling & coach-confirmation work — see
  below). Gained `coach_confirmed_at` (tap-to-confirm) alongside a column-scoped RLS grant so a
  coach can only ever update that one column on their own row.
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
is the match key. There turned out to be no Sprocket-side stable ID either (its CSV export has no
ID column), which matters for the Phase 5 work described below.

**Coach-facing entry_mode summary** (relevant since it's easy to assume more is covered than is):
`session` (pick a real calendar event) and `direct_time` (Office Hours: date + start/end time, no
calendar tie-in) are both fully coach self-service, as is an "Other (not on the calendar)" escape
hatch inside the `session` flow for a real session that isn't on the calendar. `direct_flat` (1v1)
is also coach self-service (pick a session length, no calendar tie-in). `admin_only` (Set-up/
Break-down, Stipend) is **never shown to a coach at all** — an admin has to enter these by hand on
the generic Timesheet Entries admin screen; there is no coach-initiated request/approval flow for
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

Phases 0–4 are complete and deployed (GitHub Actions → GitHub Pages on every push to `main`).
The app is in real use: admin CRUD for all reference data, coach login (magic link + password) and
self-service session logging/editing, a Sprocket calendar importer, Reconciliation, Payment Due,
and a combined Zoho Books export. Full schema is in `supabase/migrations/0001`–`0014`, applied
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
  instead of silently creating a duplicate. Known unavoidable gap: since Sprocket's own export has
  no stable event ID (confirmed by reading its CSV shape), a genuine reschedule to a different
  date is indistinguishable from "old event cancelled, new one created."
- `event_assignments` handling changes from add-only to delete-and-replace on a recognized match,
  so a dropped/swapped coach in Sprocket actually gets removed here too, not just appended to.

Item 2 (export) and the importer reconciliation upgrade above are both still blocked on seeing
Sprocket's actual bulk-import column layout.

Not carried forward from the old system: the script-pusher/Cloud project/Apps Script API
infrastructure, and the debugging detours that produced it (Drive upload conversion, OAuth scopes,
GCP project creation) — that machinery was a workaround specific to the spreadsheet architecture
with no equivalent need here.

---

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
  request resolved (`status = 'denied'`), no other change.

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
