import type { DefaultOptionType } from 'antd/es/select'

// Staff type on the roster (0032_staff_type.sql): descriptive only -- pay
// comes from rates, permissions from the role tables.
export type StaffType = 'coach' | 'nurse' | 'operations'

export const STAFF_TYPE_LABEL: Record<StaffType, string> = {
  coach: 'Coach',
  nurse: 'Nurse',
  operations: 'Operations',
}

export const STAFF_TYPE_COLOR: Record<StaffType, string> = {
  coach: 'default',
  nurse: 'magenta',
  operations: 'purple',
}

export const STAFF_TYPE_OPTIONS = (Object.keys(STAFF_TYPE_LABEL) as StaffType[]).map((value) => ({
  value,
  label: STAFF_TYPE_LABEL[value],
}))

export function parseStaffType(value: string): StaffType | null | 'bad' {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v === 'coach' || v === 'nurse') return v
  if (v === 'operations' || v === 'ops' || v === 'operation') return 'operations'
  return 'bad'
}

const GROUP_LABEL: Record<StaffType, string> = { coach: 'Coaches', nurse: 'Nurses', operations: 'Operations' }

// Options for a person picker, grouped Coaches / Nurses / Operations (Justin,
// 2026-11-01: label and sort people while scheduling). One group = a plain
// list. A missing staff_type (before 0032 runs) counts as coach.
export function staffPickerOptions(
  people: { id: string; name: string; staff_type?: StaffType | null }[],
): DefaultOptionType[] {
  const groups = (Object.keys(GROUP_LABEL) as StaffType[])
    .map((type) => ({
      label: GROUP_LABEL[type],
      options: people
        .filter((p) => (p.staff_type ?? 'coach') === type)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ label: p.name, value: p.id })),
    }))
    .filter((g) => g.options.length > 0)
  return groups.length === 1 ? groups[0].options : groups
}
