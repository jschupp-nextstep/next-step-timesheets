import { describe, expect, it } from 'vitest'

import { parseStaffType, staffPickerOptions } from './staffType'

describe('staffPickerOptions', () => {
  it('groups by staff type in Coaches / Nurses / Operations order, names sorted', () => {
    expect(
      staffPickerOptions([
        { id: '1', name: 'Zed', staff_type: 'coach' },
        { id: '2', name: 'Molly', staff_type: 'nurse' },
        { id: '3', name: 'Ella', staff_type: 'operations' },
        { id: '4', name: 'Abe' }, // before 0032: counts as coach
      ]),
    ).toEqual([
      { label: 'Coaches', options: [{ label: 'Abe', value: '4' }, { label: 'Zed', value: '1' }] },
      { label: 'Nurses', options: [{ label: 'Molly', value: '2' }] },
      { label: 'Operations', options: [{ label: 'Ella', value: '3' }] },
    ])
  })

  it('stays a plain list when everyone is the same type', () => {
    expect(staffPickerOptions([{ id: '1', name: 'Zed' }])).toEqual([{ label: 'Zed', value: '1' }])
  })
})

describe('parseStaffType', () => {
  it('reads the import column', () => {
    expect(parseStaffType('Nurse')).toBe('nurse')
    expect(parseStaffType(' ops ')).toBe('operations')
    expect(parseStaffType('')).toBeNull()
    expect(parseStaffType('manager')).toBe('bad')
  })
})
