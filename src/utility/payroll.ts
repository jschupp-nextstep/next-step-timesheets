// Shared between Payment Due, the Zoho export, and the admin Edit Entry form
// -- all need "what does this entry actually cost," and it must be exactly
// the same calculation everywhere, since Payment Due is what an admin reviews
// before trusting the export's totals, and (R8) what gets saved on the entry
// when it's marked paid.

export type PayrollEntry = {
  id: string
  coach_id: string
  program_id: string
  // The rate in effect on this date is the one that applies (R8, 0027).
  entry_date: string
  hours: number | null
  flat_amount: number | null
  programs: { entry_mode: string } | null
}

export type RateRow = {
  coach_id: string
  program_id: string
  hourly_rate: number
  // R8 (0027_rate_history.sql): a rate applies from effective_from (null =
  // since the beginning) through effective_to (null = ongoing). A rate change
  // closes the old row and starts a new one, so earlier entries keep the
  // rate that applied when they happened.
  effective_from?: string | null
  effective_to?: string | null
  is_active?: boolean
}

// (coachId, programId, date) -> the rate in effect that day, if any.
export type RateLookup = (coachId: string, programId: string, date: string) => RateRow | undefined

export function buildRateLookup(rates: RateRow[]): RateLookup {
  const byKey = new Map<string, RateRow[]>()
  for (const r of rates) {
    if (r.is_active === false) continue
    const key = `${r.coach_id}|${r.program_id}`
    byKey.set(key, [...(byKey.get(key) ?? []), r])
  }
  return (coachId, programId, date) =>
    byKey
      .get(`${coachId}|${programId}`)
      ?.find((r) => (!r.effective_from || r.effective_from <= date) && (!r.effective_to || date <= r.effective_to))
}
export type OneVOneRateRow = { coach_id: string; session_fee: number }

// How an amount was arrived at -- saved on the entry as paid_rate_basis
// (0024_paid_amounts.sql), so a Coaching-rate fallback stays visible after
// payment. 'manual' is only ever set by an admin overriding on Edit Entry.
// 'weekly' (R7, 0026): paid as part of a weekly-rate week; the entry carries
// $0 and the money is on its weekly_payments row.
export type PaidRateBasis = 'exact' | 'coaching_fallback' | 'flat' | 'one_v_one' | 'manual' | 'weekly'

export type AmountResult = {
  amount: number
  missingRate: boolean
  // Hourly rate used; null for flat fees and 1v1 sessions.
  rate: number | null
  basis: PaidRateBasis | null
}

const cents = (n: number) => Math.round(n * 100) / 100

// Mirrors the old system's rule exactly: exact-match rate first, then a
// fallback to the coach's "Coaching" rate only -- never any other program
// type's rate, and never a silent $0 when neither exists.
export function computeAmount(
  entry: PayrollEntry,
  rateFor: RateLookup,
  coachingProgramId: string | undefined,
  oneVOneByCoach: Map<string, OneVOneRateRow>,
): AmountResult {
  if (entry.flat_amount != null) return { amount: entry.flat_amount, missingRate: false, rate: null, basis: 'flat' }

  if (entry.programs?.entry_mode === 'direct_flat') {
    const rate = oneVOneByCoach.get(entry.coach_id)
    if (rate) return { amount: rate.session_fee, missingRate: false, rate: null, basis: 'one_v_one' }
    return { amount: 0, missingRate: true, rate: null, basis: null }
  }

  if (entry.hours != null) {
    const exact = rateFor(entry.coach_id, entry.program_id, entry.entry_date)
    if (exact) {
      return { amount: cents(entry.hours * exact.hourly_rate), missingRate: false, rate: exact.hourly_rate, basis: 'exact' }
    }
    const fallback = coachingProgramId ? rateFor(entry.coach_id, coachingProgramId, entry.entry_date) : undefined
    if (fallback) {
      return {
        amount: cents(entry.hours * fallback.hourly_rate),
        missingRate: false,
        rate: fallback.hourly_rate,
        basis: 'coaching_fallback',
      }
    }
    return { amount: 0, missingRate: true, rate: null, basis: null }
  }

  // No hours and no flat amount: nothing to pay it from. Treated as missing
  // rather than a silent $0, so it can't be marked paid by accident.
  return { amount: 0, missingRate: true, rate: null, basis: null }
}

export const PAID_RATE_BASIS_LABEL: Record<PaidRateBasis, string> = {
  exact: 'Program rate',
  coaching_fallback: 'Coaching rate (fallback)',
  flat: 'Flat amount',
  one_v_one: '1v1 session fee',
  manual: 'Set by admin',
  weekly: 'Weekly rate',
}
