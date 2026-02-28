import type { Note, NoteInput } from '../types/note'

export function getPendingSummaryPatch(
  pendingUpdates: Map<string, Partial<Pick<NoteInput, 'title' | 'content'>>>,
  eventNoteId: string,
  canonicalNoteId: string
): Partial<Pick<NoteInput, 'title' | 'content'>> | undefined {
  return pendingUpdates.get(canonicalNoteId) ?? pendingUpdates.get(eventNoteId)
}

export function applySummaryUpdateToNotes(
  notes: Note[],
  eventNoteId: string,
  mergedNote: Note
): Note[] {
  const targetIds = new Set<string>([eventNoteId, mergedNote.id].filter(Boolean))
  let changed = false
  const next = notes.map((note) => {
    if (!targetIds.has(note.id)) return note
    changed = true
    return mergedNote
  })
  return changed ? next : notes
}
