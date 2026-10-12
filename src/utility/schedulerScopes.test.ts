import { describe, expect, it } from 'vitest'

import { creatableOptions } from './schedulerScopes'

const programs = [
  { id: 'ts', name: 'Town Session' },
  { id: 'ap', name: 'Annual Program' },
]
const locations = [
  { id: 'wilson', name: 'Natick - Wilson' },
  { id: 'elm', name: 'Natick - Elm Bank' },
  { id: 'franklin', name: 'AP Franklin' },
]

describe('creatableOptions', () => {
  it('offers only the program/location pairs a scheduler has rules for', () => {
    const scopes = [
      { program_id: 'ts', location_id: 'wilson', coach_id: null },
      { program_id: 'ts', location_id: 'elm', coach_id: null },
    ]
    const { programOptions, locationOptions } = creatableOptions(scopes, programs, locations, 'ts')
    expect(programOptions.map((p) => p.id)).toEqual(['ts'])
    expect(locationOptions.map((l) => l.id)).toEqual(['wilson', 'elm'])
  })

  it('never lets a coach rule authorize creation', () => {
    const scopes = [{ program_id: null, location_id: null, coach_id: 'pat' }]
    const { programOptions } = creatableOptions(scopes, programs, locations)
    expect(programOptions).toEqual([])
  })

  it('treats a blank side of a rule as "any"', () => {
    const scopes = [{ program_id: 'ap', location_id: null, coach_id: null }]
    expect(creatableOptions(scopes, programs, locations, 'ap').locationOptions).toHaveLength(3)
    expect(creatableOptions(scopes, programs, locations, 'ts').locationOptions).toEqual([])
  })
})
