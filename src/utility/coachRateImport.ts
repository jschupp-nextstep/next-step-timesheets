import Papa from 'papaparse'

// Coaches & rates import (Justin, 2026-11-01): paste the rates sheet
// (Coach Name / Program Type / Hourly Rate, tab- or comma-separated) or
// upload a CSV; optional Initials / Email / Pay Type columns fill in new
// coaches. Everything here is pure so the preview the admin approves is
// exactly what gets applied.

export type ImportRow = {
  rowNumber: number
  coachName: string
  programName: string
  rate: number
  initials: string | null
  email: string | null
  payType: '1099' | 'w2' | null
}

export type ParseResult = { rows: ImportRow[]; errors: string[] }

const HEADER_ALIASES: Record<string, keyof Omit<ImportRow, 'rowNumber'>> = {
  'coach name': 'coachName',
  coach: 'coachName',
  name: 'coachName',
  'program type': 'programName',
  program: 'programName',
  'hourly rate': 'rate',
  rate: 'rate',
  initials: 'initials',
  email: 'email',
  'pay type': 'payType',
}

export const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

function parsePayType(value: string): '1099' | 'w2' | null | 'bad' {
  const v = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!v) return null
  if (v === '1099') return '1099'
  if (v === 'w2') return 'w2'
  return 'bad'
}

// Header row optional: without one, columns are Coach Name, Program, Rate.
export function parseCoachRates(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' })
  const lines = parsed.data.map((r) => r.map((c) => (c ?? '').trim()))
  const errors: string[] = []
  const rows: ImportRow[] = []
  if (lines.length === 0) return { rows, errors: ['Nothing to import.'] }

  const first = lines[0].map((c) => c.toLowerCase())
  const hasHeader = first.some((c) => HEADER_ALIASES[c] === 'coachName') && first.some((c) => HEADER_ALIASES[c] === 'rate')
  const columns: Partial<Record<keyof Omit<ImportRow, 'rowNumber'>, number>> = hasHeader
    ? Object.fromEntries(first.flatMap((c, i) => (HEADER_ALIASES[c] ? [[HEADER_ALIASES[c], i]] : [])))
    : { coachName: 0, programName: 1, rate: 2 }
  if (hasHeader && columns.programName === undefined) {
    return { rows, errors: ['The header row needs a Program Type (or Program) column.'] }
  }

  const body = hasHeader ? lines.slice(1) : lines
  body.forEach((line, i) => {
    const rowNumber = i + (hasHeader ? 2 : 1)
    const get = (key: keyof Omit<ImportRow, 'rowNumber'>) => (columns[key] === undefined ? '' : (line[columns[key]!] ?? ''))
    const coachName = get('coachName').replace(/\s+/g, ' ')
    const programName = get('programName').replace(/\s+/g, ' ')
    const rateText = get('rate').replace(/[$,\s]/g, '')
    if (!coachName && !programName && !rateText) return
    if (!coachName || !programName || !rateText) {
      errors.push(`Row ${rowNumber}: needs a coach name, program, and hourly rate.`)
      return
    }
    const rate = Number(rateText)
    if (!Number.isFinite(rate) || rate < 0) {
      errors.push(`Row ${rowNumber}: "${get('rate')}" isn't a dollar amount.`)
      return
    }
    const payType = parsePayType(get('payType'))
    if (payType === 'bad') {
      errors.push(`Row ${rowNumber}: pay type "${get('payType')}" should be 1099 or W-2.`)
      return
    }
    const email = get('email').toLowerCase()
    rows.push({
      rowNumber,
      coachName,
      programName,
      rate,
      initials: get('initials') || null,
      email: email || null,
      payType,
    })
  })
  return { rows, errors }
}

// Two letters from first + last name, e.g. "Prince Loney-Bailey" -> "PL".
export function suggestInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const firstLetter = (p: string) => p.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase()
  return parts.length === 1 ? firstLetter(parts[0]) : firstLetter(parts[0]) + firstLetter(parts[parts.length - 1])
}

export type CoachRef = { id: string; name: string; is_active: boolean }
export type ProgramRef = { id: string; name: string }
export type RateRef = {
  id: string
  coach_id: string
  program_id: string
  hourly_rate: number
  is_active: boolean
  effective_from: string | null
  effective_to: string | null
}

// What the admin decided for a name that isn't on the roster.
export type NameChoice = { kind: 'skip' } | { kind: 'new' } | { kind: 'existing'; coachId: string }

export type PlannedRate = {
  rowNumbers: number[]
  coachKey: string // coach id, or `new:<normalized name>`
  coachLabel: string
  programId: string
  programName: string
  rate: number
  status: 'new' | 'unchanged' | 'changed'
  current: RateRef | null
  // For a new rate: when it starts. Null = "since the beginning", unless an
  // earlier rate for the same coach + program has ended -- then the day after
  // (rates can't overlap, 0027).
  startFrom: string | null
}

export type ImportPlan = {
  // Blocking problems: the admin has to fix the pasted data.
  conflicts: { coachName: string; programName: string; rows: number[]; rates: number[] }[]
  unknownPrograms: { name: string; rows: number[] }[]
  // Not blocking: each needs a NameChoice (default skip).
  unmatchedNames: { name: string; rows: number[]; suggestion: CoachRef | null }[]
  newCoaches: { key: string; name: string; initials: string; email: string | null; payType: '1099' | 'w2' }[]
  rates: PlannedRate[]
  skippedRows: number
}

function dayAfter(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// The rate in effect today (or on `on`), if any.
export function currentRate(rates: RateRef[], coachId: string, programId: string, on: string): RateRef | null {
  return (
    rates.find(
      (r) =>
        r.is_active &&
        r.coach_id === coachId &&
        r.program_id === programId &&
        (!r.effective_from || r.effective_from <= on) &&
        (!r.effective_to || r.effective_to >= on),
    ) ?? null
  )
}

// A likely roster match for a name that didn't match exactly: same last name
// (or same first name) as exactly one coach.
function suggestCoach(name: string, coaches: CoachRef[]): CoachRef | null {
  const parts = normalizeName(name).split(' ')
  const last = parts[parts.length - 1]
  const firstName = parts[0]
  const byLast = coaches.filter((c) => normalizeName(c.name).split(' ').pop() === last)
  if (byLast.length === 1) return byLast[0]
  const byFirst = coaches.filter((c) => normalizeName(c.name).split(' ')[0] === firstName)
  return byFirst.length === 1 ? byFirst[0] : null
}

export function buildImportPlan(
  rows: ImportRow[],
  coaches: CoachRef[],
  programs: ProgramRef[],
  rates: RateRef[],
  choices: Record<string, NameChoice>, // keyed by normalized name
  today: string,
): ImportPlan {
  const coachByName = new Map(coaches.map((c) => [normalizeName(c.name), c]))
  const programByName = new Map(programs.map((p) => [normalizeName(p.name), p]))

  const unknownPrograms = new Map<string, { name: string; rows: number[] }>()
  const unmatched = new Map<string, { name: string; rows: number[] }>()
  for (const row of rows) {
    if (!programByName.has(normalizeName(row.programName))) {
      const k = normalizeName(row.programName)
      unknownPrograms.set(k, { name: row.programName, rows: [...(unknownPrograms.get(k)?.rows ?? []), row.rowNumber] })
    }
    if (!coachByName.has(normalizeName(row.coachName))) {
      const k = normalizeName(row.coachName)
      unmatched.set(k, { name: row.coachName, rows: [...(unmatched.get(k)?.rows ?? []), row.rowNumber] })
    }
  }

  // Resolve every row to a coach key (or skip).
  const newCoaches = new Map<string, ImportPlan['newCoaches'][number]>()
  const resolved: { row: ImportRow; coachKey: string; coachLabel: string; program: ProgramRef }[] = []
  let skippedRows = 0
  for (const row of rows) {
    const program = programByName.get(normalizeName(row.programName))
    const nameKey = normalizeName(row.coachName)
    const rosterCoach = coachByName.get(nameKey)
    let coachKey: string
    let coachLabel: string
    if (rosterCoach) {
      coachKey = rosterCoach.id
      coachLabel = rosterCoach.name
    } else {
      const choice = choices[nameKey] ?? { kind: 'skip' }
      if (choice.kind === 'skip') {
        skippedRows++
        continue
      }
      if (choice.kind === 'existing') {
        const coach = coaches.find((c) => c.id === choice.coachId)
        coachKey = choice.coachId
        coachLabel = coach?.name ?? row.coachName
      } else {
        coachKey = `new:${nameKey}`
        coachLabel = row.coachName
        const existing = newCoaches.get(coachKey)
        newCoaches.set(coachKey, {
          key: coachKey,
          name: existing?.name ?? row.coachName,
          initials: existing?.initials ?? row.initials ?? suggestInitials(row.coachName),
          email: existing?.email ?? row.email,
          payType: existing?.payType ?? row.payType ?? '1099',
        })
      }
    }
    if (!program) {
      skippedRows++
      continue
    }
    resolved.push({ row, coachKey, coachLabel, program })
  }

  // One rate per coach + program; the same rate listed twice is fine, two
  // different rates is a conflict the admin must settle in the data.
  const grouped = new Map<string, typeof resolved>()
  for (const r of resolved) {
    const k = `${r.coachKey}|${r.program.id}`
    grouped.set(k, [...(grouped.get(k) ?? []), r])
  }
  const conflicts: ImportPlan['conflicts'] = []
  const planned: PlannedRate[] = []
  for (const group of grouped.values()) {
    const distinct = [...new Set(group.map((g) => g.row.rate))]
    if (distinct.length > 1) {
      conflicts.push({
        coachName: group[0].coachLabel,
        programName: group[0].program.name,
        rows: group.map((g) => g.row.rowNumber),
        rates: distinct,
      })
      continue
    }
    const { coachKey, coachLabel, program } = group[0]
    const rate = distinct[0]
    const current = coachKey.startsWith('new:') ? null : currentRate(rates, coachKey, program.id, today)
    const lastEnded = rates
      .filter((r) => r.is_active && r.coach_id === coachKey && r.program_id === program.id && r.effective_to)
      .map((r) => r.effective_to!)
      .sort()
      .pop()
    planned.push({
      rowNumbers: group.map((g) => g.row.rowNumber),
      coachKey,
      coachLabel,
      programId: program.id,
      programName: program.name,
      rate,
      status: !current ? 'new' : Number(current.hourly_rate) === rate ? 'unchanged' : 'changed',
      current,
      startFrom: current || !lastEnded ? null : dayAfter(lastEnded),
    })
  }
  planned.sort((a, b) => a.coachLabel.localeCompare(b.coachLabel) || a.programName.localeCompare(b.programName))

  return {
    conflicts,
    unknownPrograms: [...unknownPrograms.values()],
    unmatchedNames: [...unmatched.entries()].map(([, v]) => ({ ...v, suggestion: suggestCoach(v.name, coaches) })),
    newCoaches: [...newCoaches.values()],
    rates: planned,
    skippedRows,
  }
}
