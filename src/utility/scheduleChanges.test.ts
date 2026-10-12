import { describe, expect, it } from 'vitest'

import { describeChange, type ScheduleChangeRow } from './scheduleChanges'

const names: Record<string, string> = { pat: 'Pat', keith: 'Keith' }
const coachName = (id: string | null) => (id ? (names[id] ?? 'Unknown coach') : 'Unknown coach')

const change = (overrides: Partial<ScheduleChangeRow>): ScheduleChangeRow => ({
  id: 'c1',
  batch_id: 'b1',
  change_type: 'add',
  event_id: 'e1',
  removed_coach_id: null,
  added_coach_id: null,
  old_start_time: null,
  old_end_time: null,
  new_start_time: null,
  new_end_time: null,
  reason: 'Sick',
  changed_by_email: 'nick@example.com',
  changed_by_role: 'scheduler',
  changed_at: '2026-09-14T19:10:00Z',
  review_status: 'needs_review',
  ...overrides,
})

describe('describeChange', () => {
  it('reads a sub as "X covered for Y"', () => {
    expect(describeChange(change({ change_type: 'sub', added_coach_id: 'pat', removed_coach_id: 'keith' }), coachName)).toBe(
      'Pat covered for Keith',
    )
  })

  it('describes adds and removes by coach name', () => {
    expect(describeChange(change({ change_type: 'add', added_coach_id: 'pat' }), coachName)).toBe('Added Pat')
    expect(describeChange(change({ change_type: 'remove', removed_coach_id: 'keith' }), coachName)).toBe('Removed Keith')
  })

  it('shows old and new times for a time change', () => {
    expect(
      describeChange(
        change({
          change_type: 'time',
          old_start_time: '17:00:00',
          old_end_time: '18:00:00',
          new_start_time: '17:30:00',
          new_end_time: '18:30:00',
        }),
        coachName,
      ),
    ).toBe('Time changed from 5:00 PM – 6:00 PM to 5:30 PM – 6:30 PM')
  })

  it('covers cancel, restore and create', () => {
    expect(describeChange(change({ change_type: 'cancel' }), coachName)).toBe('Cancelled the session')
    expect(describeChange(change({ change_type: 'restore' }), coachName)).toBe('Restored the cancelled session')
    expect(describeChange(change({ change_type: 'create' }), coachName)).toBe('Created the session')
  })
})
