#!/usr/bin/env node
/*
 * One-time (re-runnable) coach login provisioning.
 *
 *   1. Fills in coaches.email from a CSV of Name,Email -- matched to the
 *      roster by name (trimmed, case-insensitive, whitespace-collapsed).
 *      Never guesses: unmatched names are listed, not fuzzy-matched.
 *   2. Creates a Supabase Auth account for every coach email that doesn't
 *      have one yet, pre-confirmed. NO email is sent -- coaches just use
 *      "Email me a sign-in link" on the login page when they're ready. That
 *      keeps a bulk run from hitting Supabase's auth-email rate limit, and
 *      works with "Allow new users to sign up" turned off.
 *
 * Dry run by default; nothing is written without --apply.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/provision-coach-logins.mjs [coach-emails.csv] [--apply]
 *
 * With no CSV it only reports coaches that have an email but no login.
 *
 * The service role key bypasses RLS entirely. Pass it on the command line
 * for this run only -- never put it in .env.local, which Vite can bundle
 * into the browser.
 */

import { readFileSync } from 'node:fs'
import Papa from 'papaparse'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const csvPath = args.find((a) => !a.startsWith('--'))

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Project Settings → API).')
  process.exit(1)
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
// Supabase Auth stores emails lowercased, and current_coach_id() matches
// coaches.email to the login email exactly -- so roster emails must be too.
const normEmail = (s) => String(s ?? '').trim().toLowerCase()

const { data: coaches, error: coachesError } = await sb.from('coaches').select('id, name, email, is_active')
if (coachesError) throw coachesError
const coachesByName = new Map()
for (const c of coaches) {
  const key = normName(c.name)
  coachesByName.set(key, [...(coachesByName.get(key) ?? []), c])
}

// --- Step 1: roster emails from CSV -------------------------------------
const emailUpdates = [] // { coach, email }
if (csvPath) {
  const { data: rows } = Papa.parse(readFileSync(csvPath, 'utf8'), { header: true, skipEmptyLines: true })
  const unmatched = []
  const ambiguous = []
  const conflicts = []
  const seenEmails = new Map()
  for (const row of rows) {
    const name = row.Name ?? row.name
    const email = normEmail(row.Email ?? row.email)
    if (!name || !email) continue
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      unmatched.push(`${name} -- invalid email "${email}"`)
      continue
    }
    if (seenEmails.has(email)) {
      conflicts.push(`${email} is listed for both ${seenEmails.get(email)} and ${name}`)
      continue
    }
    seenEmails.set(email, name)
    const matches = coachesByName.get(normName(name)) ?? []
    if (matches.length === 0) unmatched.push(name)
    else if (matches.length > 1) ambiguous.push(name)
    else if (matches[0].email && matches[0].email !== email) {
      conflicts.push(`${matches[0].name} already has ${matches[0].email} on the roster (CSV says ${email}) -- left alone`)
    } else if (matches[0].email !== email) emailUpdates.push({ coach: matches[0], email })
  }
  console.log(`\nCSV: ${rows.length} rows -> ${emailUpdates.length} roster emails to set`)
  if (unmatched.length) console.log(`\nNot on the roster (fix the name in the CSV or the roster):\n  - ${unmatched.join('\n  - ')}`)
  if (ambiguous.length) console.log(`\nMatches more than one roster coach:\n  - ${ambiguous.join('\n  - ')}`)
  if (conflicts.length) console.log(`\nSkipped:\n  - ${conflicts.join('\n  - ')}`)
}

// --- Step 2: auth accounts ----------------------------------------------
const authEmails = new Set()
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  for (const u of data.users) if (u.email) authEmails.add(u.email.toLowerCase())
  if (data.users.length < 1000) break
}

const finalEmails = new Map(coaches.map((c) => [c.id, c.email ? normEmail(c.email) : null]))
for (const { coach, email } of emailUpdates) finalEmails.set(coach.id, email)
const needLogin = coaches.filter((c) => c.is_active && finalEmails.get(c.id) && !authEmails.has(finalEmails.get(c.id)))
const stillNoEmail = coaches.filter((c) => c.is_active && !finalEmails.get(c.id))

console.log(`\nActive coaches: ${coaches.filter((c) => c.is_active).length}`)
console.log(`  logins to create: ${needLogin.length}`)
console.log(`  still no email on roster: ${stillNoEmail.length}`)
if (stillNoEmail.length) console.log(`    ${stillNoEmail.map((c) => c.name).join(', ')}`)

if (!apply) {
  console.log('\nDry run -- nothing written. Re-run with --apply to make these changes.')
  process.exit(0)
}

let failures = 0
for (const { coach, email } of emailUpdates) {
  const { error } = await sb.from('coaches').update({ email }).eq('id', coach.id)
  if (error) {
    failures++
    console.error(`  ✗ ${coach.name}: couldn't set email -- ${error.message}`)
    finalEmails.set(coach.id, coach.email ? normEmail(coach.email) : null)
  }
}
for (const coach of needLogin) {
  const email = finalEmails.get(coach.id)
  if (!email) continue
  const { error } = await sb.auth.admin.createUser({ email, email_confirm: true })
  if (error) {
    failures++
    console.error(`  ✗ ${coach.name}: couldn't create login -- ${error.message}`)
  }
}
console.log(failures ? `\nDone with ${failures} failure(s) above.` : '\nDone.')
