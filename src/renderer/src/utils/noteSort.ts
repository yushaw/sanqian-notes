import type { Note } from '../types/note'

/**
 * Default note comparator: pinned notes first, then by updated_at descending.
 * Used across note creation, duplication, restore, and toggle-pinned flows.
 */
export function compareNotesByPinnedAndUpdated(a: Note, b: Note): number {
  if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
}
