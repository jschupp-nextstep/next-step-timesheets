import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { gameWarmupMinutes, parseSprocketCsv } from './parseSprocketCsv'

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
