// Generic, storage-key-parameterized version of the remembered-mappings
// mechanism sprocket-import/index.tsx keeps inline for itself. Used by the
// native bulk importer (src/pages/bulk-import) only -- the Sprocket importer
// is left untouched, with its own local copy of this same pattern.

export type ImportMappingCategory = 'programs' | 'locations' | 'coaches'
export type StoredImportMappings = Record<ImportMappingCategory, Record<string, string>>

export function loadStoredMappings(storageKey: string): StoredImportMappings {
  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      programs: parsed.programs ?? {},
      locations: parsed.locations ?? {},
      coaches: parsed.coaches ?? {},
    }
  } catch {
    return { programs: {}, locations: {}, coaches: {} }
  }
}

export function saveStoredMapping(
  storageKey: string,
  category: ImportMappingCategory,
  key: string,
  value: string | null,
) {
  const stored = loadStoredMappings(storageKey)
  if (value) {
    stored[category][key] = value
  } else {
    delete stored[category][key]
  }
  localStorage.setItem(storageKey, JSON.stringify(stored))
}
