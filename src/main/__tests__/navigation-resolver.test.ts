import { describe, expect, it } from 'vitest'
import { resolveRendererNoteIdForNavigation } from '../navigation-resolver'

describe('resolveRendererNoteIdForNavigation', () => {
  it('keeps internal note id unchanged', () => {
    const result = resolveRendererNoteIdForNavigation('note-1', {
      getNoteById: (noteId) => (noteId === 'note-1' ? { id: noteId } : null),
      getLocalNoteIdentityByUid: () => null,
    })
    expect(result).toBe('note-1')
  })

  it('normalizes local path id for renderer navigation', () => {
    const result = resolveRendererNoteIdForNavigation('local:nb-1:docs%2Fplan.md', {
      getNoteById: () => null,
      getLocalNoteIdentityByUid: () => null,
    })
    expect(result).toBe('local:nb-1:docs%2Fplan.md')
  })

  it('resolves local uid resource id to local path id', () => {
    const uid = 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53'
    const result = resolveRendererNoteIdForNavigation(`local:nb-1:uid:${uid}`, {
      getNoteById: () => null,
      getLocalNoteIdentityByUid: ({ note_uid, notebook_id }) => {
        if (note_uid !== uid || notebook_id !== 'nb-1') {
          return null
        }
        return {
          notebook_id: 'nb-1',
          relative_path: 'docs/plan.md',
        }
      },
    })
    expect(result).toBe('local:nb-1:docs%2Fplan.md')
  })

  it('resolves raw local uuid id to local path id', () => {
    const uid = 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53'
    const result = resolveRendererNoteIdForNavigation(uid, {
      getNoteById: () => null,
      getLocalNoteIdentityByUid: ({ note_uid, notebook_id }) => {
        if (note_uid !== uid || notebook_id) return null
        return {
          notebook_id: 'nb-2',
          relative_path: 'foo/bar.md',
        }
      },
    })
    expect(result).toBe('local:nb-2:foo%2Fbar.md')
  })

  it('returns original id when local identity is missing', () => {
    const uid = 'ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53'
    const result = resolveRendererNoteIdForNavigation(uid, {
      getNoteById: () => null,
      getLocalNoteIdentityByUid: () => null,
    })
    expect(result).toBe(uid)
  })
})
