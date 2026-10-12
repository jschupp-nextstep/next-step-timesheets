import { describe, expect, it } from 'vitest'

import { scheduleErrorMessage } from './scheduleActions'

describe('scheduleErrorMessage', () => {
  it('returns null when there is no error', () => {
    expect(scheduleErrorMessage(null)).toBeNull()
  })

  it("passes the database's own refusal through verbatim", () => {
    for (const message of [
      "Not allowed: you don't manage this event.",
      'Not allowed: coaches can\'t change the schedule. Use "Request swap" in My Sessions instead.',
      "Not allowed: you can't create events for this program at this location.",
      'A reason is required for every schedule change.',
    ]) {
      expect(scheduleErrorMessage({ message, code: '42501' })).toBe(message)
    }
  })

  it('never returns an empty message for an error', () => {
    expect(scheduleErrorMessage({ message: '' })).toMatch(/nothing was changed/i)
    expect(scheduleErrorMessage({})).toMatch(/nothing was changed/i)
  })

  it('explains network failures instead of showing a raw fetch error', () => {
    expect(scheduleErrorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/couldn't reach the server/i)
  })
})
