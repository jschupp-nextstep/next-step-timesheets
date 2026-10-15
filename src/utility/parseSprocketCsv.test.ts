import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { gameWarmupMinutes, parseCoachNames, parseSprocketCsv } from './parseSprocketCsv'

describe('gameWarmupMinutes (R3)', () => {
  it('pays a game from its arrival time', () => {
    expect(gameWarmupMinutes({ ClubEventType: 'Game', ArrivalTime: '09:30 AM', StartDateTime: '10:00 AM' })).toBe(30)
  })

  it('ignores ArrivalTime on practices and club events', () => {
    expect(gameWarmupMinutes({ ClubEventType: 'Practice', ArrivalTime: '06:15 PM', StartDateTime: '06:30 PM' })).toBeNull()
    expect(gameWarmupMinutes({ ClubEventType: 'Club', ArrivalTime: '08:10 AM', StartDateTime: '08:15 AM' })).toBeNull()
  })

  it('ignores a missing or non-earlier arrival', () => {
    expect(gameWarmupMinutes({ ClubEventType: 'Game', ArrivalTime: '', StartDateTime: '10:00 AM' })).toBeNull()
    expect(gameWarmupMinutes({ ClubEventType: 'Game', ArrivalTime: '10:00 AM', StartDateTime: '10:00 AM' })).toBeNull()
  })
})

describe('parseSprocketCsv on the real July export', () => {
  it('sets no warm-up on any practice row, even though ArrivalTime is filled on nearly all of them', () => {
    let csv: string
    try {
      csv = readFileSync(new URL('../../July Calendar.csv', import.meta.url), 'utf8')
    } catch {
      return // export not present in this checkout
    }
    const { events } = parseSprocketCsv(csv)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.paidEarlyMinutes === null)).toBe(true)
  })
})

describe('parseCoachNames (fall import)', () => {
  it('splits the separators used in Notes', () => {
    expect(parseCoachNames('Max + Taron')).toEqual(['Max', 'Taron'])
    expect(parseCoachNames('Matteus & Joselito')).toEqual(['Matteus', 'Joselito'])
    expect(parseCoachNames('Taron/Matteus')).toEqual(['Taron', 'Matteus'])
    expect(parseCoachNames('Ben + Ryan + Taron')).toEqual(['Ben', 'Ryan', 'Taron'])
  })

  it('drops parentheticals and things that are not names', () => {
    expect(parseCoachNames('Joselito (combined session with G4.2)')).toEqual(['Joselito'])
    expect(parseCoachNames('Please arrive 30 minutes before game time.')).toEqual([])
    expect(parseCoachNames('')).toEqual([])
  })
})

const row = (over: Record<string, string>) => ({
  Title: 'Practice',
  StartDate: '10/19/2026',
  StartDateTime: '04:00 PM',
  EndDateTime: '05:00 PM',
  LocationName: 'Field A',
  ProgramName: 'Town Sessions 2026-2027',
  TeamName: 'Team 1',
  IsCancelled: 'No',
  ArrivalTime: '',
  ClubEventType: 'Practice',
  Notes: '',
  Opponent: '',
  AwayGame: 'No',
  ClubCalendarEventID: '1',
  ...over,
})
const toCsv = (rows: Record<string, string>[]) =>
  [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map((v) => `"${v}"`).join(','))].join('\n')

describe('parseSprocketCsv (fall export shapes)', () => {
  it('reads coaches from Notes and from a dashed title suffix, and keeps the Sprocket id', () => {
    const { events } = parseSprocketCsv(
      toCsv([
        row({ Title: 'Goalie Clinic — Jack', Notes: 'Jack', ClubCalendarEventID: '11' }),
        row({ Title: 'Tech', TeamName: 'Team 2', Notes: 'Max + Taron', ClubCalendarEventID: '12' }),
      ]),
    )
    expect(events[0]).toMatchObject({ title: 'Goalie Clinic', assignedCoachNames: ['Jack'], sprocketIds: ['11'], needsTeamCoach: false })
    expect(events[1].assignedCoachNames).toEqual(['Max', 'Taron'])
  })

  it('names a game from team and opponent, flags it for the team coach, and sets its warm-up', () => {
    const { events } = parseSprocketCsv(
      toCsv([row({ Title: '', ClubEventType: 'Game', TeamName: 'DSA BU14', Opponent: 'Bolts', ArrivalTime: '03:30 PM' })]),
    )
    expect(events[0]).toMatchObject({ sessionName: 'DSA BU14 vs Bolts', needsTeamCoach: true, paidEarlyMinutes: 30 })
  })

  it('gives each town its own blank-location placeholder', () => {
    const { events } = parseSprocketCsv(
      toCsv([
        row({ LocationName: '', TeamName: 'Dedham DOC', ClubCalendarEventID: '1' }),
        row({ LocationName: '', TeamName: 'Quincy - B6.2', ClubCalendarEventID: '2' }),
        row({ LocationName: '', TeamName: 'Quincy - G4.4', ClubCalendarEventID: '3' }),
      ]),
    )
    expect(events.map((e) => e.locationName)).toEqual([
      '(no location on Sprocket) · Dedham DOC',
      '(no location on Sprocket) · Quincy',
      '(no location on Sprocket) · Quincy',
    ])
  })

  it('skips Other rows and Club rows that duplicate a team session, keeps a lone Club row', () => {
    const { events, skipped } = parseSprocketCsv(
      toCsv([
        row({ ClubCalendarEventID: '1' }),
        row({ Title: 'Annual Program', ClubEventType: 'Club', TeamName: '', ProgramName: '', ClubCalendarEventID: '2' }),
        row({ Title: 'AP Mondays', ClubEventType: 'Club', TeamName: '', StartDateTime: '06:00 PM', ClubCalendarEventID: '3' }),
        row({ Title: 'Party', ClubEventType: 'Other', ClubCalendarEventID: '4' }),
      ]),
    )
    expect(events.map((e) => e.title)).toEqual(['Practice', 'AP Mondays'])
    expect(skipped.map((s) => s.type)).toEqual(['Club', 'Other'])
  })
})

describe('parseSprocketCsv on the real fall export', () => {
  it('imports every practice and game with an id, and finds coaches on most of them', () => {
    let csv: string
    try {
      csv = readFileSync(new URL('../../Fall Calendar.csv', import.meta.url), 'utf8')
    } catch {
      return // export not present in this checkout
    }
    const { events, skipped } = parseSprocketCsv(csv)
    expect(skipped).toHaveLength(27) // 25 duplicate Club rows + 2 Other
    expect(events).toHaveLength(375)
    expect(events.every((e) => e.sprocketIds.length === 1)).toBe(true)
    expect(events.filter((e) => e.sessionName.includes(' vs ') || e.sessionName.includes(' @ '))).toHaveLength(24)
    expect(events.filter((e) => !e.needsTeamCoach).length).toBeGreaterThan(200)
  })
})
