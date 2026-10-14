import dayjs from 'dayjs'

export type ScheduleChangeRow = {
  id: string
  batch_id: string
  change_type: 'create' | 'sub' | 'add' | 'remove' | 'time' | 'cancel' | 'restore'
  event_id: string
  removed_coach_id: string | null
  added_coach_id: string | null
  old_start_time: string | null
  old_end_time: string | null
  new_start_time: string | null
  new_end_time: string | null
  reason: string
  changed_by_email: string
  changed_by_role: 'admin' | 'scheduler'
  changed_at: string
  review_status: 'needs_review' | 'reviewed' | 'reversed'
  // 0029: a scheduler filling an unstaffed future session -- logged, not reviewed
  routine?: boolean
}

export const formatTime = (t: string | null) => (t ? dayjs(`2000-01-01T${t}`).format('h:mm A') : '?')

export const formatTimeRange = (start: string | null, end: string | null) => {
  if (!start) return 'No time set'
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start)
}

// One line per change, for the event history and (R2c) the review queue.
// "Pat covered Keith" is the sentence payroll needs to read.
export function describeChange(change: ScheduleChangeRow, coachName: (id: string | null) => string): string {
  switch (change.change_type) {
    case 'sub':
      return `${coachName(change.added_coach_id)} covered for ${coachName(change.removed_coach_id)}`
    case 'add':
      return `Added ${coachName(change.added_coach_id)}`
    case 'remove':
      return `Removed ${coachName(change.removed_coach_id)}`
    case 'time':
      return `Time changed from ${formatTimeRange(change.old_start_time, change.old_end_time)} to ${formatTimeRange(change.new_start_time, change.new_end_time)}`
    case 'cancel':
      return 'Cancelled the session'
    case 'restore':
      return 'Restored the cancelled session'
    case 'create':
      return 'Created the session'
  }
}

// R6 (0028): when a cancellation happened.
export type CancellationTiming = 'in_advance' | 'same_day' | 'after_arrival'
export const CANCELLATION_TIMING_LABEL: Record<string, string> = {
  in_advance: 'Cancelled in advance',
  same_day: 'Cancelled same day',
  after_arrival: 'Cancelled after arrival',
}
export const CANCELLATION_TIMING_OPTIONS = [
  { value: 'in_advance', label: 'In advance' },
  { value: 'same_day', label: 'Same day (before arrival)' },
  { value: 'after_arrival', label: 'After coaches arrived' },
]
