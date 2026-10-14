import type { AdminFlag } from './payrollFilters'

// R4 (0025_entry_flags.sql) labels and helpers shared by admin and coach screens.
export const ADMIN_FLAG_LABEL: Record<AdminFlag, string> = {
  hold: 'On hold',
  canceled: 'Canceled',
  not_next_step: 'Not Next Step',
}

export type EntryMessage = {
  id: string
  entry_id: string
  author_role: 'admin' | 'coach'
  author_email: string
  body: string
  created_at: string
}

// "Awaiting coach" when the last message is from Next Step; "Coach replied"
// otherwise -- what an admin scanning the On hold list needs to know.
export const threadState = (messages: EntryMessage[]) =>
  messages.length > 0 && messages[messages.length - 1].author_role === 'coach' ? 'replied' : 'awaiting_coach'
