import { useEffect, useState } from 'react'

import { supabaseClient } from './supabaseClient'

// AP back-to-back (src/utils/hours.ts paidEarlyMinutes): when does this
// coach's previous session -- same day, same location, starting earlier --
// end? From the schedule (sessions they're assigned to) and from what they've
// logged, so it doesn't matter which of two back-to-back sessions they
// confirm first. Null = no earlier session there that day.

type SessionRef = { id: string; event_date: string; location_id: string; start_time: string | null }

export async function loadCoachPreviousEnd(coachId: string, event: SessionRef): Promise<string | null> {
  if (!event.start_time) return null
  const [assigned, logged] = await Promise.all([
    supabaseClient
      .from('events')
      .select('end_time, event_assignments!inner(coach_id)')
      .eq('event_date', event.event_date)
      .eq('location_id', event.location_id)
      .eq('is_cancelled', false)
      .neq('id', event.id)
      .lt('start_time', event.start_time)
      .eq('event_assignments.coach_id', coachId),
    supabaseClient
      .from('timesheet_entries')
      .select('events!inner(end_time, event_date, location_id, start_time)')
      .eq('coach_id', coachId)
      .neq('event_id', event.id)
      .eq('events.event_date', event.event_date)
      .eq('events.location_id', event.location_id)
      .lt('events.start_time', event.start_time),
  ])
  if (assigned.error) throw new Error(assigned.error.message)
  if (logged.error) throw new Error(logged.error.message)
  const ends = [
    ...(assigned.data ?? []).map((e) => e.end_time as string | null),
    ...((logged.data ?? []) as unknown as { events: { end_time: string | null } }[]).map((e) => e.events.end_time),
  ].filter((t): t is string => !!t)
  return ends.length ? ends.sort().at(-1)! : null
}

// For screens that compute paid time while rendering (Confirm hours,
// corrections). `ready` stays false until it's known, so nothing is saved
// with the full early minutes by mistake.
export function useCoachPreviousEnd(coachId: string | null | undefined, event: SessionRef | null | undefined) {
  const [state, setState] = useState<{ key: string; previousEnd: string | null; error: string | null } | null>(null)
  const key = coachId && event ? `${coachId}|${event.id}|${event.event_date}|${event.location_id}|${event.start_time}` : ''

  useEffect(() => {
    if (!key || !coachId || !event) return
    let cancelled = false
    loadCoachPreviousEnd(coachId, event)
      .then((previousEnd) => !cancelled && setState({ key, previousEnd, error: null }))
      .catch((e: Error) => !cancelled && setState({ key, previousEnd: null, error: e.message }))
    return () => {
      cancelled = true
    }
    // key covers every field used
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current = state?.key === key ? state : null
  return { previousEnd: current?.previousEnd ?? null, ready: !key || !!current, error: current?.error ?? null }
}
