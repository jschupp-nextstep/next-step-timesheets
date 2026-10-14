import { useState } from 'react'
import { App } from 'antd'

import { supabaseClient } from './supabaseClient'

// Every schedule change goes through one of these database functions (see
// supabase/migrations/0020_schedule_changes.sql). They check permission,
// apply the change, and log it in one transaction -- and raise a message
// written for a person when the caller isn't allowed.
export type ScheduleFunction =
  | 'schedule_sub'
  | 'schedule_add'
  | 'schedule_remove'
  | 'schedule_change_time'
  | 'schedule_set_cancelled'
  | 'schedule_create_event'
  | 'schedule_mark_reviewed'
  | 'schedule_reverse'
  | 'schedule_cancel_day'

type RpcError = { message?: string; code?: string; details?: string | null; hint?: string | null } | null

// The functions' own messages ("Not allowed: you don't manage this event.")
// are shown verbatim. Anything else -- a network failure, an unexpected
// Postgres error -- still surfaces rather than being swallowed.
export function scheduleErrorMessage(error: RpcError): string | null {
  if (!error) return null
  const message = error.message?.trim()
  if (!message) return 'The change could not be saved. Nothing was changed.'
  if (/failed to fetch|network/i.test(message)) {
    return "Couldn't reach the server, so nothing was changed. Check your connection and try again."
  }
  return message
}

// Entry flag/thread functions (R4, 0025_entry_flags.sql) -- same contract:
// the database checks permission and raises a person-readable message.
export type EntryFunction = 'hold_entry' | 'flag_entry' | 'clear_entry_flag' | 'admin_entry_message' | 'coach_reply_entry'

// How UI code calls a permission-checking database function: it shows the
// error (and returns false) on any failure, so no screen can silently
// swallow a refusal.
export function useScheduleAction() {
  return useRpcAction<ScheduleFunction>()
}

export function useEntryAction() {
  return useRpcAction<EntryFunction>()
}

function useRpcAction<F extends string>() {
  const { message } = App.useApp()
  const [running, setRunning] = useState(false)

  // successMessage null = no toast (the caller shows its own, e.g. swap
  // approval); errors are always shown regardless.
  const run = async (fn: F, args: Record<string, unknown>, successMessage: string | null) => {
    setRunning(true)
    try {
      const { error } = await supabaseClient.rpc(fn, args)
      const errorMessage = scheduleErrorMessage(error)
      if (errorMessage) {
        message.error({ content: errorMessage, duration: 6 })
        return false
      }
      if (successMessage) message.success(successMessage)
      return true
    } catch (e) {
      message.error({ content: scheduleErrorMessage({ message: (e as Error).message }) ?? 'Something went wrong.', duration: 6 })
      return false
    } finally {
      setRunning(false)
    }
  }

  return { run, running }
}
