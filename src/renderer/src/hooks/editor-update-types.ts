import type { NoteInput } from '../types/note'

/** Partial note patch used by the editor save queue. */
export type EditorNoteUpdate = Partial<Pick<NoteInput, 'title' | 'content'>>

/** Timeout (ms) for flush operations before destructive actions (delete, move, etc.). */
export const DESTRUCTIVE_FLUSH_WAIT_TIMEOUT_MS = 8000
