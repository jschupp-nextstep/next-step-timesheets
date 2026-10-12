export type ScopeLabelRow = {
  programs: { name: string } | null
  locations: { name: string } | null
  coaches: { name: string } | null
}

// Plain-language version of one scheduler_scopes rule (see 0017_roles.sql).
export const describeScope = (scope: ScopeLabelRow) => {
  if (scope.coaches) return `Any event with ${scope.coaches.name}`
  if (scope.programs && scope.locations) return `${scope.programs.name} at ${scope.locations.name}`
  return scope.programs ? `All ${scope.programs.name}` : `Everything at ${scope.locations?.name ?? '?'}`
}

export type CreateScopeRow = { program_id: string | null; location_id: string | null; coach_id: string | null }
export type IdName = { id: string; name: string }

// Only program/location rules authorize creation (0020_schedule_changes.sql);
// a null side of a rule means "any". These options are a convenience --
// schedule_create_event re-checks, and its refusal is what gets shown.
export function creatableOptions(scopes: CreateScopeRow[], programs: IdName[], locations: IdName[], programId?: string) {
  const rules = scopes.filter((s) => !s.coach_id)
  const programOptions = rules.some((r) => !r.program_id)
    ? programs
    : programs.filter((p) => rules.some((r) => r.program_id === p.id))
  const forProgram = rules.filter((r) => !r.program_id || r.program_id === programId)
  const locationOptions = !programId
    ? []
    : forProgram.some((r) => !r.location_id)
      ? locations
      : locations.filter((l) => forProgram.some((r) => r.location_id === l.id))
  return { programOptions, locationOptions }
}
