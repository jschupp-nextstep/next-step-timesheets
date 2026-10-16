// Catches the two upload mistakes seen on 2026-10-16 before any parsing:
// a non-CSV file (an Apple Numbers/Excel copy dragged in -- `accept=".csv"`
// only filters the file picker, not drag-and-drop) and a file meant for the
// other importer. Returns a message to show, or null if the file looks right.
export type ImporterKind = 'sprocket' | 'bulk'

export function checkImportFile(fileName: string, text: string, importer: ImporterKind): string | null {
  if (!/\.csv$/i.test(fileName)) {
    return `"${fileName}" isn't a CSV file. Upload the .csv export itself, not a Numbers or Excel copy (or use File → Export To → CSV).`
  }
  const header = text.slice(0, 2000).split(/\r?\n/)[0] ?? ''
  const isSprocket = /ClubCalendarEventID|StartDateTime|ClubEventType/.test(header)
  const isBulk = /(^|,)\s*"?Coaches"?\s*(,|$)/.test(header) && /(^|,)\s*"?Start Time"?\s*(,|$)/.test(header)
  if (importer === 'bulk' && isSprocket) {
    return 'This is a Sprocket calendar export. Upload it on Import Calendar instead.'
  }
  if (importer === 'sprocket' && isBulk) {
    return "This is a bulk-import file (the app's own format). Upload it on Bulk Import Events instead."
  }
  return null
}
