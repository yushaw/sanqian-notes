import { describe, expect, it } from 'vitest'
import type { Note, Notebook } from '../../shared/types'
import {
  buildNotesOverviewContext,
  buildNotesOverviewContextAsync,
  buildNotebooksOverviewContext,
  buildNotebooksOverviewContextAsync,
  type AsyncContextOverviewDataSource,
  type ContextOverviewDataSource,
  type ContextOverviewNote,
  type UserContextSnapshot,
} from '../context-overview'

function createNote(id: string, overrides: Partial<Note> = {}): Note {
  const merged = {
    id,
    title: `Note ${id}`,
    content: '',
    notebook_id: null,
    folder_path: null,
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

  return {
    ...merged,
    folder_path: merged.folder_path ?? null,
  }
}

function createNotebook(id: string, name: string): Notebook {
  return {
    id,
    name,
    source_type: 'internal',
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  }
}

function createDataSource(params: {
  notebooks?: Notebook[]
  noteCounts?: Record<string, number>
  noteCountByNotebookId?: (notebookId: string) => number
  noteById?: ContextOverviewNote | null
  recentNotes?: ContextOverviewNote[]
}): ContextOverviewDataSource {
  const notebooks = params.notebooks ?? []
  const noteCounts = params.noteCounts ?? {}
  const noteCountByNotebookId = params.noteCountByNotebookId
  const noteById = params.noteById ?? null
  const recentNotes = params.recentNotes ?? []

  return {
    getNotebooks: () => notebooks,
    getNoteCountByNotebook: () => noteCounts,
    getNoteCountByNotebookId: noteCountByNotebookId,
    getNoteById: () => noteById,
    getNotes: (limit: number, offset: number) => recentNotes.slice(offset, offset + limit),
  }
}

function createAsyncDataSource(params: {
  notebooks?: Notebook[]
  noteCounts?: Record<string, number>
  noteCountByNotebookId?: (notebookId: string) => number
  noteById?: ContextOverviewNote | null
  recentNotes?: ContextOverviewNote[]
}): AsyncContextOverviewDataSource {
  const sync = createDataSource(params)
  return {
    getNotebooks: async () => sync.getNotebooks(),
    getNoteCountByNotebook: async () => sync.getNoteCountByNotebook(),
    getNoteCountByNotebookId: sync.getNoteCountByNotebookId
      ? async (notebookId: string) => sync.getNoteCountByNotebookId!(notebookId)
      : undefined,
    getNoteById: async (id: string) => sync.getNoteById(id),
    getNotes: async (limit: number, offset: number) => sync.getNotes(limit, offset),
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

  it('builds notes overview for local-folder current note', () => {
    const localCurrent: ContextOverviewNote = {
      id: 'local:nb-local:docs%2Fplan.md',
      title: 'Local Plan',
      notebook_id: 'nb-local',
      updated_at: '2026-02-01T11:00:00.000Z',
      deleted_at: null,
      ai_summary: null,
      source_type: 'local-folder',
      relative_path: 'docs/plan.md',
    }
    const ds = createDataSource({
      notebooks: [createNotebook('nb-local', 'Local Notebook')],
      noteById: localCurrent,
      recentNotes: [localCurrent],
    })

    const context = buildNotesOverviewContext(
      { ...baseContext, currentNoteId: localCurrent.id },
      ds
    )

    expect(context.metadata).toMatchObject({
      currentNoteId: localCurrent.id,
    })
    expect(context.content).toContain('Current note: "Local Plan"')
    expect(context.content).toContain('Notebook: Local Notebook')
    expect(context.content).toContain('Path: docs/plan.md')
    expect(context.content).not.toContain('not found in database')
  })

  it('sanitizes inline context text fields', () => {
    const note = createNote('note-1', {
      title: 'Line1\n<unsafe>',
      notebook_id: 'nb-1',
      ai_summary: 'summary\n<script>alert(1)</script>',
    })
    const ds = createDataSource({
      notebooks: [createNotebook('nb-1', 'Work\n<unsafe>')],
      noteById: note,
      recentNotes: [note],
    })

    const context = buildNotesOverviewContext(
      { ...baseContext, currentNoteId: 'note-1' },
      ds
    )

    expect(context.content).toContain('Current note: "Line1 ＜unsafe＞"')
    expect(context.content).toContain('Notebook: Work ＜unsafe＞')
    expect(context.content).toContain('Summary: summary ＜script＞alert(1)＜/script＞')
    expect(context.content).not.toContain('\n<unsafe>')
  })

  it('limits recently updated notes to top 3', () => {
    const notes = [
      createNote('note-1', { title: 'N1' }),
      createNote('note-2', { title: 'N2' }),
      createNote('note-3', { title: 'N3' }),
      createNote('note-4', { title: 'N4' }),
    ]
    const ds = createDataSource({
      notebooks: [createNotebook('nb-1', 'Work')],
      recentNotes: notes,
    })

    const context = buildNotesOverviewContext(baseContext, ds)

    expect(context.metadata).toMatchObject({
      recentNoteIds: ['note-1', 'note-2', 'note-3'],
    })
    expect(context.content).toContain('1. "N1" (ID: note-1')
    expect(context.content).toContain('2. "N2" (ID: note-2')
    expect(context.content).toContain('3. "N3" (ID: note-3')
    expect(context.content).not.toContain('"N4" (ID: note-4')
  })

  it('can omit current note block to reduce duplicated context payload', () => {
    const current = createNote('note-1', {
      title: 'Current',
      notebook_id: 'nb-1',
      updated_at: '2026-02-01T10:00:00.000Z',
    })
    const ds = createDataSource({
      notebooks: [createNotebook('nb-1', 'Work')],
      noteById: current,
      recentNotes: [current],
    })

    const context = buildNotesOverviewContext(
      { ...baseContext, currentNoteId: 'note-1', currentNoteTitle: 'Current' },
      ds,
      { includeCurrentNote: false }
    )

    expect(context.content).not.toContain('Current note: "Current"')
    expect(context.content).toContain('Recently updated notes:')
    expect(context.content).toContain('1. "Current" (ID: note-1')
  })

  it('builds notebooks overview without notebook ranking list', () => {
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
    expect(context.content).not.toContain('Notebooks by note count:')
  })

  it('prefers targeted notebook count resolver when provided', () => {
    const notebooks = [
      createNotebook('nb-a', 'Alpha'),
    ]
    const ds = createDataSource({
      notebooks,
      noteCounts: { 'nb-a': 1 },
      noteCountByNotebookId: () => 42,
    })

    const context = buildNotebooksOverviewContext(
      { ...baseContext, currentNotebookId: 'nb-a' },
      ds
    )

    expect(context.content).toContain('Notes in current notebook: 42')
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

  it('builds notes overview from async data source', async () => {
    const note = createNote('note-a', {
      title: 'Async Note',
      notebook_id: 'nb-a',
      updated_at: '2026-02-01T12:00:00.000Z',
      ai_summary: 'Async summary',
    })
    const ds = createAsyncDataSource({
      notebooks: [createNotebook('nb-a', 'Async NB')],
      noteById: note,
      recentNotes: [note],
    })

    const context = await buildNotesOverviewContextAsync(
      { ...baseContext, currentNoteId: 'note-a' },
      ds
    )

    expect(context.summary).toBe('Current note: Async Note')
    expect(context.content).toContain('Notebook: Async NB')
    expect(context.content).toContain('Summary: Async summary')
  })

  it('builds notebooks overview from async data source', async () => {
    const ds = createAsyncDataSource({
      notebooks: [createNotebook('nb-a', 'Async NB')],
      noteCounts: { 'nb-a': 3 },
      noteCountByNotebookId: () => 3,
    })

    const context = await buildNotebooksOverviewContextAsync(
      { ...baseContext, currentNotebookId: 'nb-a' },
      ds
    )

    expect(context.summary).toBe('Current notebook: Async NB')
    expect(context.content).toContain('Notes in current notebook: 3')
  })
})
