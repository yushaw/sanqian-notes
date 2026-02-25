import { describe, expect, it } from 'vitest'
import type { Note, Notebook } from '../../shared/types'
import {
  buildNotesOverviewContext,
  buildNotebooksOverviewContext,
  type ContextOverviewDataSource,
  type UserContextSnapshot,
} from '../context-overview'

function createNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `Note ${id}`,
    content: '',
    notebook_id: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ai_summary: null,
    tags: [],
    ...overrides,
  }
}

function createNotebook(id: string, name: string): Notebook {
  return {
    id,
    name,
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function createDataSource(params: {
  notebooks?: Notebook[]
  noteCounts?: Record<string, number>
  noteById?: Note | null
  recentNotes?: Note[]
}): ContextOverviewDataSource {
  const notebooks = params.notebooks ?? []
  const noteCounts = params.noteCounts ?? {}
  const noteById = params.noteById ?? null
  const recentNotes = params.recentNotes ?? []

  return {
    getNotebooks: () => notebooks,
    getNoteCountByNotebook: () => noteCounts,
    getNoteById: () => noteById,
    getNotes: () => recentNotes,
  }
}

const baseContext: UserContextSnapshot = {
  currentNotebookId: null,
  currentNotebookName: null,
  currentNoteId: null,
  currentNoteTitle: null,
}

describe('context-overview', () => {
  it('builds notes overview with current note and recent notes', () => {
    const note1 = createNote('note-1', {
      title: 'Current Plan',
      notebook_id: 'nb-1',
      updated_at: '2026-02-01T10:00:00.000Z',
      ai_summary: 'Summary content',
    })
    const note2 = createNote('note-2', {
      title: '',
      notebook_id: null,
      updated_at: '2026-02-01T09:00:00.000Z',
    })
    const ds = createDataSource({
      notebooks: [createNotebook('nb-1', 'Work')],
      noteById: note1,
      recentNotes: [note1, note2],
    })

    const context = buildNotesOverviewContext(
      { ...baseContext, currentNoteId: 'note-1' },
      ds
    )

    expect(context.title).toBe('Notes Overview')
    expect(context.summary).toBe('Current note: Current Plan')
    expect(context.metadata).toMatchObject({
      currentNoteId: 'note-1',
      recentNoteIds: ['note-1', 'note-2'],
    })
    expect(context.content).toContain('Current note: "Current Plan" (ID: note-1)')
    expect(context.content).toContain('Notebook: Work')
    expect(context.content).toContain('1. "Current Plan" (ID: note-1, notebook: Work')
    expect(context.content).toContain('2. "Untitled" (ID: note-2, notebook: Unfiled')
  })

  it('builds notes overview when current note is missing', () => {
    const ds = createDataSource({
      noteById: null,
      recentNotes: [],
    })

    const context = buildNotesOverviewContext(
      { ...baseContext, currentNoteId: 'missing', currentNoteTitle: 'Ghost Note' },
      ds
    )

    expect(context.summary).toBe('0 recent notes')
    expect(context.metadata).toMatchObject({
      currentNoteId: null,
      recentNoteIds: [],
    })
    expect(context.content).toContain('Current note: "Ghost Note" (not found in database)')
    expect(context.content).toContain('No notes found.')
  })

  it('builds notebooks overview sorted by note count then notebook name', () => {
    const notebooks = [
      createNotebook('nb-z', 'Zeta'),
      createNotebook('nb-a', 'Alpha'),
      createNotebook('nb-b', 'Beta'),
    ]
    const ds = createDataSource({
      notebooks,
      noteCounts: {
        'nb-z': 2,
        'nb-a': 2,
        'nb-b': 5,
      },
    })

    const context = buildNotebooksOverviewContext(
      { ...baseContext, currentNotebookId: 'nb-a' },
      ds
    )

    expect(context.summary).toBe('Current notebook: Alpha')
    expect(context.metadata).toMatchObject({
      currentNotebookId: 'nb-a',
      notebookCount: 3,
    })
    expect(context.content).toContain('Current notebook: "Alpha" (ID: nb-a)')
    expect(context.content).toContain('Notes in current notebook: 2')
    expect(context.content).toContain('1. "Beta" (ID: nb-b, notes: 5)')
    expect(context.content).toContain('2. "Alpha" (ID: nb-a, notes: 2)')
    expect(context.content).toContain('3. "Zeta" (ID: nb-z, notes: 2)')
  })

  it('builds notebooks overview when current notebook is not found', () => {
    const ds = createDataSource({
      notebooks: [],
      noteCounts: {},
    })

    const context = buildNotebooksOverviewContext(
      { ...baseContext, currentNotebookId: 'missing', currentNotebookName: 'Unknown' },
      ds
    )

    expect(context.summary).toBe('0 notebooks')
    expect(context.metadata).toMatchObject({
      currentNotebookId: null,
      notebookCount: 0,
    })
    expect(context.content).toContain('Current notebook: "Unknown" (not found in database)')
    expect(context.content).toContain('No notebooks found.')
  })
})
