import { describe, expect, it, vi } from 'vitest'
import type {
  Note,
  NoteInput,
  NoteSearchFilter,
  NoteUpdateSafeResult,
} from '../../shared/types'
import type { SearchScopeResolveResult } from '../search-scope'
import { registerNoteIpc, type NoteIpcDependencies } from '../ipc/register-note-ipc'

const NOW = '2026-02-26T00:00:00.000Z'

function createNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Title',
    content: 'Content',
    notebook_id: 'nb-1',
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 1,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ai_summary: null,
    tags: [],
    ...overrides,
  }
}

function createDeps(overrides: Partial<NoteIpcDependencies> = {}): NoteIpcDependencies {
  return {
    ...baseDeps(),
    ...overrides,
  }
}

function baseDeps(): NoteIpcDependencies {
  return {
    getAllNotesForRendererAsync: vi.fn(async () => [createNote()]),
    getNoteByIdForRenderer: vi.fn(() => createNote()),
    getNotesByIdsForRenderer: vi.fn(() => [createNote()]),
    addNote: vi.fn((note: NoteInput) => createNote({ title: note.title, content: note.content })),
    getNoteById: vi.fn(() => createNote()),
    updateNote: vi.fn((id: string, updates: Partial<NoteInput>) => createNote({ id, ...updates })),
    updateNoteSafe: vi.fn((): NoteUpdateSafeResult => ({
      status: 'updated',
      note: createNote({ notebook_id: 'nb-2' }),
    })),
    updateNoteNotebookId: vi.fn(),
    checkAndIndex: vi.fn(async () => true),
    deleteNote: vi.fn(() => true),
    deleteNoteIndex: vi.fn(),
    searchNotes: vi.fn(() => [createNote()]),
    resolveSearchScope: vi.fn((): SearchScopeResolveResult => ({ success: true, scope: { kind: 'global' } })),
    createDemoNote: vi.fn(() => undefined),
    getDailyByDate: vi.fn(() => createNote({ is_daily: true })),
    createDaily: vi.fn(() => createNote({ id: 'daily-1', is_daily: true })),
    getTrashNotes: vi.fn(() => [createNote({ deleted_at: NOW })]),
    restoreNote: vi.fn(() => true),
    getEmbeddingConfig: vi.fn(() => ({ enabled: false })),
    indexNoteFull: vi.fn(async () => undefined),
    indexNoteFtsOnly: vi.fn(async () => undefined),
    permanentlyDeleteNote: vi.fn(() => true),
    emptyTrash: vi.fn(() => 0),
    cleanupOldTrash: vi.fn(() => 0),
  }
}

type Handler = (...args: unknown[]) => unknown

function createIpcMainLike() {
  const channels = new Map<string, Handler>()
  return {
    channels,
    ipcMainLike: {
      handle: vi.fn((channel: string, listener: Handler) => {
        channels.set(channel, listener)
      }),
    },
  }
}

describe('register-note-ipc', () => {
  it('registers note/daily/trash IPC handlers', () => {
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, createDeps())

    expect(ipcMainLike.handle).toHaveBeenCalledTimes(17)
    expect(channels.has('note:getAll')).toBe(true)
    expect(channels.has('note:updateSafe')).toBe(true)
    expect(channels.has('note:search')).toBe(true)
    expect(channels.has('daily:getByDate')).toBe(true)
    expect(channels.has('trash:restore')).toBe(true)
  })

  it('routes note:search through search scope resolver', () => {
    const deps = createDeps()
    deps.resolveSearchScope = vi.fn((): SearchScopeResolveResult => ({
      success: true,
      scope: { kind: 'current_notebook', notebookId: 'nb-2' },
    }))
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:search')
    expect(handler).toBeDefined()
    if (!handler) return

    const filter: NoteSearchFilter = { notebookId: 'nb-2', viewType: 'all' }
    handler({}, 'query', filter)

    expect(deps.resolveSearchScope).toHaveBeenCalledWith({
      entryId: 'notebook_search',
      notebookId: 'nb-2',
    })
    expect(deps.searchNotes).toHaveBeenCalledWith('query', { notebookId: 'nb-2' })
  })

  it('updates embedding index for restored notes and notebook move updates', async () => {
    const deps = createDeps({
      getNoteById: vi
        .fn()
        .mockReturnValueOnce(createNote({ notebook_id: 'nb-1' }))
        .mockReturnValueOnce(createNote({ notebook_id: 'nb-1', content: 'restored content' })),
      updateNoteSafe: vi.fn((): NoteUpdateSafeResult => ({
        status: 'updated',
        note: createNote({ notebook_id: 'nb-2' }),
      })),
      getEmbeddingConfig: vi.fn(() => ({ enabled: false })),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const updateSafeHandler = channels.get('note:updateSafe')
    expect(updateSafeHandler).toBeDefined()
    if (!updateSafeHandler) return

    updateSafeHandler({}, 'note-1', { notebook_id: 'nb-2' }, 1)
    expect(deps.updateNoteNotebookId).toHaveBeenCalledWith('note-1', 'nb-2')

    const restoreHandler = channels.get('trash:restore')
    expect(restoreHandler).toBeDefined()
    if (!restoreHandler) return

    await restoreHandler({}, 'note-1')
    expect(deps.indexNoteFtsOnly).toHaveBeenCalledWith('note-1', 'nb-1', 'restored content')
    expect(deps.indexNoteFull).not.toHaveBeenCalled()
  })
})
