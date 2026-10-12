import { useOne } from '@refinedev/core'

// Single-row table (id = 1) -- see supabase/migrations/0015_cutover.sql.
export type AppSettings = {
  id: number
  cutover_date: string | null
  paid_through_date: string | null
}

export function useAppSettings() {
  const { result, query } = useOne<AppSettings>({ resource: 'app_settings', id: 1 })
  return {
    settings: result,
    cutoverDate: result?.cutover_date ?? null,
    paidThroughDate: result?.paid_through_date ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
  }
}

// True when a date is before the cutover from the old Sheets system --
// sessions from then were paid there, so a coach can't log or claim them
// here (RLS enforces this too; this is just the client-side mirror).
export function isBeforeCutover(dateStr: string, cutoverDate: string | null): boolean {
  return !!cutoverDate && dateStr < cutoverDate
}
