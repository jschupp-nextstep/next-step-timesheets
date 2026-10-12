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
