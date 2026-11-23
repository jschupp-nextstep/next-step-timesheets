import dayjs from 'dayjs'

import { supabaseClient } from './supabaseClient'
import type { AppRowCandidate } from './sprocketLink'

type Row = {
  id: string
  event_id: string
  sprocket_team_id: string | null
  sprocket_teams: { name: string } | null
  events: {
    event_date: string
    start_time: string | null
    session_name: string | null
    event_type: string | null
    programs: { name: string } | null
    locations: { name: string; sprocket_location_id: string | null } | null
  }
}

// The app's rows not yet in Sprocket (state new) on sessions dated from..to.
export async function loadUnlinkedAppRows(from: string, to: string): Promise<{ rows: AppRowCandidate[]; error: string | null }> {
  const { data, error } = await supabaseClient
    .from('event_sprocket_rows')
    .select(
      'id, event_id, sprocket_team_id, sprocket_teams(name), events!inner(event_date, start_time, session_name, event_type, programs(name), locations(name, sprocket_location_id))',
    )
    .eq('state', 'new')
    .gte('events.event_date', from)
    .lte('events.event_date', to)
    .range(0, 9999)
  if (error) return { rows: [], error: error.message }
  const rows = ((data ?? []) as unknown as Row[]).map((r) => {
    const e = r.events
    const title = e.event_type === 'game' ? '' : e.session_name || e.programs?.name || ''
    return {
      rowId: r.id,
      eventId: r.event_id,
      sprocketTeamId: r.sprocket_team_id,
      locationSprocketId: e.locations?.sprocket_location_id ?? null,
      eventDate: e.event_date,
      startTime: e.start_time,
      expectedTitle: title,
      label: `${dayjs(e.event_date).format('ddd M/D')}${e.start_time ? ' ' + dayjs(`2000-01-01T${e.start_time}`).format('h:mm A') : ''} · ${
        title || e.programs?.name || 'Game'
      } · ${r.sprocket_teams?.name ?? 'Club'} · ${e.locations?.name ?? '?'}`,
    }
  })
  return { rows, error: null }
}

// Sprocket IDs the app already knows (linked rows, or on an event).
export async function loadKnownSprocketIds(ids: string[]): Promise<{ known: Set<string>; error: string | null }> {
  const known = new Set<string>()
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const [rows, events] = await Promise.all([
      supabaseClient.from('event_sprocket_rows').select('club_calendar_event_id').in('club_calendar_event_id', chunk),
      supabaseClient.from('events').select('sprocket_event_ids').overlaps('sprocket_event_ids', chunk),
    ])
    const err = rows.error ?? events.error
    if (err) return { known, error: err.message }
    for (const r of rows.data ?? []) if (r.club_calendar_event_id) known.add(r.club_calendar_event_id)
    for (const e of events.data ?? []) for (const id of e.sprocket_event_ids ?? []) known.add(id)
  }
  return { known, error: null }
}
