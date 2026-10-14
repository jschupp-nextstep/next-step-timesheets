// R5: flag sessions where both a covering coach and the coach they covered
// for logged hours (the Pat/Keith and Norley/Bryce pattern from the Sep–Oct
// run). Events legitimately have several coaches, so this can't be a
// uniqueness rule -- it compares who logged against who was scheduled and
// who was covering for whom. Flags only; an admin decides (e.g. Hold one).

export type DPEntry = {
  id: string
  coach_id: string
  event_id: string
  status: 'pending' | 'paid'
  admin_flag?: string | null
}
export type DPAssignment = { event_id: string; coach_id: string; covering_for_coach_id: string | null }
// A sub recorded in schedule_changes (still counts after the covering
// assignment itself is later removed). Reversed subs are ignored.
export type DPSub = { event_id: string; removed_coach_id: string | null; added_coach_id: string | null; review_status: string }
export type DPClaim = { event_id: string; coach_id: string }

export type DPReason =
  | { kind: 'more_logged_than_scheduled'; logged: number; scheduled: number }
  | { kind: 'cover_and_original_logged'; coverId: string; originalId: string }
  | { kind: 'claim_and_assigned_logged'; claimantId: string; assignedIds: string[] }

export type DPFlag<E> = { eventId: string; reasons: DPReason[]; entries: E[] }

export function findDoublePay<E extends DPEntry>(
  entries: E[],
  assignments: DPAssignment[],
  subs: DPSub[],
  approvedUnassignedClaims: DPClaim[],
): DPFlag<E>[] {
  // Canceled / Not Next Step entries are already never paid.
  const counted = entries.filter((e) => e.admin_flag !== 'canceled' && e.admin_flag !== 'not_next_step')
  const byEvent = new Map<string, E[]>()
  for (const e of counted) byEvent.set(e.event_id, [...(byEvent.get(e.event_id) ?? []), e])

  const flags: DPFlag<E>[] = []
  for (const [eventId, eventEntries] of byEvent) {
    const loggedCoaches = new Set(eventEntries.map((e) => e.coach_id))
    if (loggedCoaches.size < 2) continue
    const eventAssignments = assignments.filter((a) => a.event_id === eventId)
    const assigned = new Set(eventAssignments.map((a) => a.coach_id))
    const reasons: DPReason[] = []

    if (assigned.size > 0 && loggedCoaches.size > assigned.size) {
      reasons.push({ kind: 'more_logged_than_scheduled', logged: loggedCoaches.size, scheduled: assigned.size })
    }

    const pairs = new Set<string>()
    for (const a of eventAssignments) {
      if (a.covering_for_coach_id) pairs.add(`${a.coach_id}|${a.covering_for_coach_id}`)
    }
    for (const s of subs) {
      if (s.event_id === eventId && s.review_status !== 'reversed' && s.added_coach_id && s.removed_coach_id) {
        pairs.add(`${s.added_coach_id}|${s.removed_coach_id}`)
      }
    }
    for (const pair of pairs) {
      const [coverId, originalId] = pair.split('|')
      if (loggedCoaches.has(coverId) && loggedCoaches.has(originalId)) {
        reasons.push({ kind: 'cover_and_original_logged', coverId, originalId })
      }
    }

    for (const c of approvedUnassignedClaims) {
      if (c.event_id !== eventId || !loggedCoaches.has(c.coach_id)) continue
      const assignedWhoLogged = [...assigned].filter((id) => id !== c.coach_id && loggedCoaches.has(id))
      if (assignedWhoLogged.length > 0) {
        reasons.push({ kind: 'claim_and_assigned_logged', claimantId: c.coach_id, assignedIds: assignedWhoLogged })
      }
    }

    if (reasons.length > 0) flags.push({ eventId, reasons, entries: eventEntries })
  }
  return flags
}

export function describeDoublePay(reason: DPReason, name: (coachId: string) => string): string {
  switch (reason.kind) {
    case 'more_logged_than_scheduled':
      return `${reason.logged} coaches logged hours but only ${reason.scheduled} ${reason.scheduled === 1 ? 'was' : 'were'} scheduled`
    case 'cover_and_original_logged':
      return `${name(reason.coverId)} covered for ${name(reason.originalId)}, and both logged hours`
    case 'claim_and_assigned_logged':
      return `${name(reason.claimantId)} was approved for an unassigned spot while ${reason.assignedIds.map(name).join(', ')} (scheduled) also logged hours`
  }
}
