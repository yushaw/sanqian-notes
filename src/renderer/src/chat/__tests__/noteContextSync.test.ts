import { describe, expect, it } from 'vitest'
import {
  applyNoteContextPayload,
  shouldApplyInitialNoteContextSnapshot,
  type NoteContextPayload,
} from '../noteContextSync'

describe('noteContextSync', () => {
  it('does not bump revision when payload is unchanged', () => {
    const current: NoteContextPayload = { noteId: 'note-a', noteTitle: 'A' }
    const result = applyNoteContextPayload(current, { noteId: 'note-a', noteTitle: 'A' }, 3)

    expect(result.changed).toBe(false)
    expect(result.nextRevision).toBe(3)
    expect(result.nextPayload).toBe(current)
  })

  it('bumps revision when payload changes', () => {
    const current: NoteContextPayload = { noteId: 'note-a', noteTitle: 'A' }
    const incoming: NoteContextPayload = { noteId: 'note-b', noteTitle: 'B' }
    const result = applyNoteContextPayload(current, incoming, 3)

    expect(result.changed).toBe(true)
    expect(result.nextRevision).toBe(4)
    expect(result.nextPayload).toEqual(incoming)
  })

  it('accepts initial snapshot only when no realtime update happened after request start', () => {
    expect(shouldApplyInitialNoteContextSnapshot(7, 7)).toBe(true)
    expect(shouldApplyInitialNoteContextSnapshot(7, 8)).toBe(false)
  })

  it('prevents stale initial payload from overriding newer realtime note context', () => {
    const initialContext: NoteContextPayload = { noteId: null, noteTitle: null }
    const initialRequestRevision = 0

    const realtime = applyNoteContextPayload(
      initialContext,
      { noteId: 'note-new', noteTitle: 'New' },
      0
    )
    expect(realtime.changed).toBe(true)

    const canApplyStaleInitial = shouldApplyInitialNoteContextSnapshot(
      initialRequestRevision,
      realtime.nextRevision
    )
    expect(canApplyStaleInitial).toBe(false)
  })
})
