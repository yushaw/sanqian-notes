import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Note, NoteInput } from '../types/note'
import { applySummaryUpdateToNotes, getPendingSummaryPatch } from '../utils/summaryEvents'

interface UseSummaryUpdateListenerOptions {
  pendingEditorUpdatesRef: MutableRefObject<Map<string, Partial<Pick<NoteInput, 'title' | 'content'>>>>
  notesRef: MutableRefObject<Note[]>
  setNotes: Dispatch<SetStateAction<Note[]>>
}

export function useSummaryUpdateListener(options: UseSummaryUpdateListenerOptions): void {
  const {
    pendingEditorUpdatesRef,
    notesRef,
    setNotes,
  } = options

  useEffect(() => {
    const cleanup = window.electron.note.onSummaryUpdated(async (noteId: string) => {
      console.log('[App] Summary updated for note:', noteId)
      try {
        const updatedNote = await window.electron.note.getById(noteId)
        if (updatedNote) {
          const pending = getPendingSummaryPatch(
            pendingEditorUpdatesRef.current,
            noteId,
            updatedNote.id
          )
          const mergedNote = pending ? { ...updatedNote, ...pending } : updatedNote
          notesRef.current = applySummaryUpdateToNotes(notesRef.current, noteId, mergedNote)
          setNotes((prev) => applySummaryUpdateToNotes(prev, noteId, mergedNote))
        }
      } catch (error) {
        console.error('[App] Failed to update note summary:', error)
      }
    })
    return cleanup
  }, [notesRef, pendingEditorUpdatesRef, setNotes])
}
