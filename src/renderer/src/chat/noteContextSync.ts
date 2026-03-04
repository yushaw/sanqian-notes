export interface NoteContextPayload {
  noteId: string | null
  noteTitle: string | null
}

export interface ApplyNoteContextResult {
  changed: boolean
  nextRevision: number
  nextPayload: NoteContextPayload
}

export function isSameNoteContext(
  left: NoteContextPayload,
  right: NoteContextPayload
): boolean {
  return left.noteId === right.noteId && left.noteTitle === right.noteTitle
}

export function applyNoteContextPayload(
  currentPayload: NoteContextPayload,
  incomingPayload: NoteContextPayload,
  currentRevision: number
): ApplyNoteContextResult {
  if (isSameNoteContext(currentPayload, incomingPayload)) {
    return {
      changed: false,
      nextRevision: currentRevision,
      nextPayload: currentPayload,
    }
  }

  return {
    changed: true,
    nextRevision: currentRevision + 1,
    nextPayload: incomingPayload,
  }
}

/**
 * Guard for initial snapshot responses:
 * if revision changed after request started, a newer realtime event has arrived,
 * so the initial payload should be ignored to avoid stale overwrite.
 */
export function shouldApplyInitialNoteContextSnapshot(
  requestRevision: number,
  currentRevision: number
): boolean {
  return requestRevision === currentRevision
}
