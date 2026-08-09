// Shared between Payment Due and the Zoho export -- both need to compute
// "what does this entry actually cost," and it must be exactly the same
// calculation in both places, since Payment Due is what an admin reviews
// before trusting the export's totals.

export type PayrollEntry = {
  id: string
  coach_id: string
  program_id: string
  hours: number | null
  flat_amount: number | null
  programs: { entry_mode: string } | null
}

export type RateRow = { coach_id: string; program_id: string; hourly_rate: number }
export type OneVOneRateRow = { coach_id: string; session_fee: number }

// Mirrors the old system's rule exactly: exact-match rate first, then a
// fallback to the coach's "Coaching" rate only -- never any other program
// type's rate, and never a silent $0 when neither exists.
export function computeAmount(
  entry: PayrollEntry,
  ratesByCoachProgram: Map<string, RateRow>,
  coachingProgramId: string | undefined,
  oneVOneByCoach: Map<string, OneVOneRateRow>,
): { amount: number; missingRate: boolean } {
  if (entry.flat_amount != null) return { amount: entry.flat_amount, missingRate: false }

  if (entry.programs?.entry_mode === 'direct_flat') {
    const rate = oneVOneByCoach.get(entry.coach_id)
    if (rate) return { amount: rate.session_fee, missingRate: false }
    return { amount: 0, missingRate: true }
  }

  if (entry.hours != null) {
    const exact = ratesByCoachProgram.get(`${entry.coach_id}|${entry.program_id}`)
    if (exact) return { amount: entry.hours * exact.hourly_rate, missingRate: false }
    const fallback = coachingProgramId
      ? ratesByCoachProgram.get(`${entry.coach_id}|${coachingProgramId}`)
      : undefined
    if (fallback) return { amount: entry.hours * fallback.hourly_rate, missingRate: false }
    return { amount: 0, missingRate: true }
  }

  return { amount: 0, missingRate: false }
}
