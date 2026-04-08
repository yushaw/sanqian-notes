const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseRequiredLocalNoteUidInput(noteUidInput: unknown): string | null {
  if (typeof noteUidInput !== 'string') return null
  if (!noteUidInput.trim()) return null
  // Keep note UID values opaque and reject trim-alias values explicitly.
  if (noteUidInput !== noteUidInput.trim()) return null
  // UUIDs are canonicalized to lowercase; non-UUID legacy UIDs are preserved as-is.
  if (UUID_V4_RE.test(noteUidInput)) return noteUidInput.toLowerCase()
  return noteUidInput
}

/**
 * Internal repair helper for persisted dirty rows:
 * - first try strict parse (no trim aliases)
 * - then try trim-normalized parse for legacy values like ` uid-1 `
 */
export function normalizeStoredLocalNoteUidForRepair(noteUidInput: unknown): string | null {
  if (typeof noteUidInput !== 'string') return null
  const parsed = parseRequiredLocalNoteUidInput(noteUidInput)
  if (parsed) return parsed
  const trimmed = noteUidInput.trim()
  if (!trimmed) return null
  return parseRequiredLocalNoteUidInput(trimmed)
}
