import { supabaseClient } from '../../utility/supabaseClient'
import type { ImportPlan } from '../../utility/coachRateImport'

// How a changed rate is written: from a date (history kept via change_rate)
// or corrected in place (it was always meant to be the new amount; already
// paid entries keep their saved amounts either way, 0024).
export type ChangeMode = { kind: 'from_date'; from: string } | { kind: 'correct' }

export type ApplyResult = {
  coachesCreated: number
  ratesAdded: number
  ratesChanged: number
  failures: string[]
}

// Applies an import plan one write at a time so a single bad row (e.g. an
// email already on another coach) is reported without stopping the rest.
// New coaches first, since their rates need the new ids.
export async function applyCoachRates(
  plan: ImportPlan,
  changeMode: ChangeMode | null,
  onProgress: (done: number, total: number) => void,
): Promise<ApplyResult> {
  const toAdd = plan.rates.filter((r) => r.status === 'new')
  const toChange = plan.rates.filter((r) => r.status === 'changed')
  const total = plan.newCoaches.length + toAdd.length + (changeMode ? toChange.length : 0)
  let done = 0
  const step = () => onProgress(++done, total)
  const result: ApplyResult = { coachesCreated: 0, ratesAdded: 0, ratesChanged: 0, failures: [] }

  const newIds = new Map<string, string>()
  for (const coach of plan.newCoaches) {
    const { data, error } = await supabaseClient
      .from('coaches')
      .insert({ name: coach.name, initials: coach.initials, email: coach.email, pay_type: coach.payType })
      .select('id')
      .single()
    if (error) result.failures.push(`Couldn't add ${coach.name}: ${error.message} (their rates were skipped)`)
    else {
      newIds.set(coach.key, data.id)
      result.coachesCreated++
    }
    step()
  }

  for (const rate of toAdd) {
    const coachId = rate.coachKey.startsWith('new:') ? newIds.get(rate.coachKey) : rate.coachKey
    if (!coachId) {
      step()
      continue
    }
    const { error } = await supabaseClient.from('rates').insert({
      coach_id: coachId,
      program_id: rate.programId,
      hourly_rate: rate.rate,
      is_active: true,
      effective_from: rate.startFrom,
    })
    if (error) result.failures.push(`${rate.coachLabel} · ${rate.programName}: ${error.message}`)
    else result.ratesAdded++
    step()
  }

  if (changeMode) {
    for (const rate of toChange) {
      const { error } =
        changeMode.kind === 'from_date'
          ? await supabaseClient.rpc('change_rate', {
              p_rate_id: rate.current!.id,
              p_new_rate: rate.rate,
              p_from: changeMode.from,
            })
          : await supabaseClient.from('rates').update({ hourly_rate: rate.rate }).eq('id', rate.current!.id)
      if (error) result.failures.push(`${rate.coachLabel} · ${rate.programName}: ${error.message}`)
      else result.ratesChanged++
      step()
    }
  }
  return result
}
