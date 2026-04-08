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

  it('passes validated note:getAll options to synthesis dependencies', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:getAll')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, {
      includeLocal: true,
      includeLocalContent: false,
      viewType: 'recent',
      recentDays: 14,
    })).resolves.toEqual([createNote()])
    expect(deps.getAllNotesForRendererAsync).toHaveBeenCalledWith({
      includeLocal: true,
      includeLocalContent: false,
      viewType: 'recent',
      recentDays: 14,
    })
  })

  it('caps note:getAll recentDays to safe upper bound', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:getAll')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, {
      viewType: 'recent',
      recentDays: 999999,
    })).resolves.toEqual([createNote()])
    expect(deps.getAllNotesForRendererAsync).toHaveBeenCalledWith({
      viewType: 'recent',
      recentDays: 36500,
    })
  })

  it('fails closed for invalid note:getAll options payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:getAll')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, null)).resolves.toEqual([])
    await expect(handler({}, { includeLocal: 'yes' })).resolves.toEqual([])
    await expect(handler({}, { viewType: 'archived' })).resolves.toEqual([])
    await expect(handler({}, { recentDays: 0 })).resolves.toEqual([])
    expect(deps.getAllNotesForRendererAsync).not.toHaveBeenCalled()
  })

  it('supports async note:getById and note:getByIds dependencies', async () => {
    const expectedSingle = createNote({ id: 'note-async-1' })
    const expectedBatch = [createNote({ id: 'note-async-2' })]
    const deps = createDeps({
      getNoteByIdForRenderer: vi.fn(async () => expectedSingle),
      getNotesByIdsForRenderer: vi.fn(async () => expectedBatch),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const getByIdHandler = channels.get('note:getById')
    const getByIdsHandler = channels.get('note:getByIds')
    expect(getByIdHandler).toBeDefined()
    expect(getByIdsHandler).toBeDefined()
    if (!getByIdHandler || !getByIdsHandler) return

    await expect(getByIdHandler({}, 'note-async-1')).resolves.toEqual(expectedSingle)
    await expect(getByIdsHandler({}, ['note-async-2'])).resolves.toEqual(expectedBatch)
    expect(deps.getNoteByIdForRenderer).toHaveBeenCalledWith('note-async-1')
    expect(deps.getNotesByIdsForRenderer).toHaveBeenCalledWith(['note-async-2'])
  })

  it('fails closed for invalid note id payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const getByIdHandler = channels.get('note:getById')
    const getByIdsHandler = channels.get('note:getByIds')
    expect(getByIdHandler).toBeDefined()
    expect(getByIdsHandler).toBeDefined()
    if (!getByIdHandler || !getByIdsHandler) return

    await expect(getByIdHandler({}, 123)).resolves.toBeNull()
    await expect(getByIdHandler({}, 'note\0bad')).resolves.toBeNull()
    await expect(getByIdHandler({}, 'x'.repeat(4097))).resolves.toBeNull()
    await expect(getByIdsHandler({}, ['note-1', null])).resolves.toEqual([])
    await expect(getByIdsHandler({}, ['x'.repeat(4097)])).resolves.toEqual([])
    expect(deps.getNoteByIdForRenderer).not.toHaveBeenCalled()
    expect(deps.getNotesByIdsForRenderer).not.toHaveBeenCalled()
  })

  it('fails closed for oversized note:getByIds payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const getByIdsHandler = channels.get('note:getByIds')
    expect(getByIdsHandler).toBeDefined()
    if (!getByIdsHandler) return

    const oversizedIds = Array.from({ length: 2001 }, (_, index) => `note-${index}`)
    await expect(getByIdsHandler({}, oversizedIds)).resolves.toEqual([])
    expect(deps.getNotesByIdsForRenderer).not.toHaveBeenCalled()
  })

  it('rejects note:add payloads with invalid optional field types', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:add')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, {
      title: 'Title',
      content: 'Content',
      is_daily: 'true',
    })).rejects.toThrow('note:add payload must be an object with string title/content')
    await expect(handler({}, {
      title: 'Title',
      content: 'Content',
      notebook_id: { id: 'nb-1' },
    })).rejects.toThrow('note:add payload must be an object with string title/content')
    await expect(handler({}, {
      title: 'Title\0',
      content: 'Content',
    })).rejects.toThrow('note:add payload must be an object with string title/content')
    await expect(handler({}, {
      title: 'Title',
      content: 'Content\0',
    })).rejects.toThrow('note:add payload must be an object with string title/content')
    expect(deps.addNote).not.toHaveBeenCalled()
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

  it('does not broaden to global search when notebook filter is explicit but invalid', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:search')
    expect(handler).toBeDefined()
    if (!handler) return

    const result = await handler({}, 'query', { notebookId: '' })
    expect(result).toEqual([])
    expect(deps.resolveSearchScope).not.toHaveBeenCalled()
    expect(deps.searchNotes).not.toHaveBeenCalled()
  })

  it('does not broaden to global search when notebook filter is explicit but non-string', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:search')
    expect(handler).toBeDefined()
    if (!handler) return

    const result = await handler({}, 'query', { notebookId: 123 as unknown as string })
    expect(result).toEqual([])
    expect(deps.resolveSearchScope).not.toHaveBeenCalled()
    expect(deps.searchNotes).not.toHaveBeenCalled()
  })

  it('fails closed for invalid note:search filter payload shape', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:search')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'query', null)).resolves.toEqual([])
    await expect(handler({}, 'query', ['nb-1'])).resolves.toEqual([])
    await expect(handler({}, 'query', { viewType: 'archived' })).resolves.toEqual([])
    expect(deps.resolveSearchScope).not.toHaveBeenCalled()
    expect(deps.searchNotes).not.toHaveBeenCalled()
  })

  it('treats explicit undefined notebook filter as omitted (global scope)', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:search')
    expect(handler).toBeDefined()
    if (!handler) return

    await handler({}, 'query', { notebookId: undefined } as any)

    expect(deps.resolveSearchScope).toHaveBeenCalledWith({
      entryId: 'global_search',
      notebookId: null,
    })
    expect(deps.searchNotes).toHaveBeenCalledWith('query', { notebookId: undefined })
  })

  it('fails closed for non-string query input', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:search')
    expect(handler).toBeDefined()
    if (!handler) return

    const result = await handler({}, 123, { notebookId: 'nb-1' })
    expect(result).toEqual([])
    expect(deps.resolveSearchScope).not.toHaveBeenCalled()
    expect(deps.searchNotes).not.toHaveBeenCalled()
  })

  it('fails closed for oversized note:search query payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const handler = channels.get('note:search')
    expect(handler).toBeDefined()
    if (!handler) return

    const oversizedQuery = 'q'.repeat(10001)
    const result = await handler({}, oversizedQuery, { notebookId: 'nb-1' })
    expect(result).toEqual([])
    const nullByteResult = await handler({}, 'q\0uery', { notebookId: 'nb-1' })
    expect(nullByteResult).toEqual([])
    expect(deps.resolveSearchScope).not.toHaveBeenCalled()
    expect(deps.searchNotes).not.toHaveBeenCalled()
  })

  it('fails closed for invalid update payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const updateHandler = channels.get('note:update')
    const updateSafeHandler = channels.get('note:updateSafe')
    expect(updateHandler).toBeDefined()
    expect(updateSafeHandler).toBeDefined()
    if (!updateHandler || !updateSafeHandler) return

    await expect(updateHandler({}, 'note-1', 'invalid')).resolves.toBeNull()
    await expect(updateHandler({}, 'note-1', ['not', 'an', 'object'])).resolves.toBeNull()
    await expect(updateHandler({}, 'note-1', { is_daily: 'yes' })).resolves.toBeNull()
    await expect(updateHandler({}, 'note-1', { notebook_id: 'nb-1\0bad' })).resolves.toBeNull()
    await expect(updateHandler({}, 'note-1', { notebook_id: 'x'.repeat(1025) })).resolves.toBeNull()
    await expect(updateHandler({}, 'note-1', { folder_path: 'docs\0bad' })).resolves.toBeNull()
    await expect(updateHandler({}, 'note-1', { folder_path: 'x'.repeat(4097) })).resolves.toBeNull()
    await expect(updateHandler({}, 'note-1', { daily_date: 'x'.repeat(65) })).resolves.toBeNull()
    await expect(updateSafeHandler({}, 'note-1', { notebook_id: { id: 'nb-1' } }, 1)).resolves.toEqual({
      status: 'failed',
      error: 'note_not_found',
    })
    await expect(updateSafeHandler({}, 'note-1', { title: 'ok' }, -1)).resolves.toEqual({
      status: 'failed',
      error: 'note_not_found',
    })
    await expect(updateSafeHandler({}, 'note-1', ['not', 'an', 'object'], 1)).resolves.toEqual({
      status: 'failed',
      error: 'note_not_found',
    })
    expect(deps.updateNote).not.toHaveBeenCalled()
    expect(deps.updateNoteSafe).not.toHaveBeenCalled()
  })

  it('fails closed for invalid checkIndex and trash restore payloads', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerNoteIpc(ipcMainLike, deps)

    const checkIndexHandler = channels.get('note:checkIndex')
    const restoreHandler = channels.get('trash:restore')
    const permanentDeleteHandler = channels.get('trash:permanentDelete')
    expect(checkIndexHandler).toBeDefined()
    expect(restoreHandler).toBeDefined()
    expect(permanentDeleteHandler).toBeDefined()
    if (!checkIndexHandler || !restoreHandler || !permanentDeleteHandler) return

    await expect(checkIndexHandler({}, null, 'nb-1', 'content')).resolves.toBe(false)
    await expect(checkIndexHandler({}, 'note\0id', 'nb-1', 'content')).resolves.toBe(false)
    await expect(checkIndexHandler({}, 'note-1', 'nb-1\0bad', 'content')).resolves.toBe(false)
    await expect(checkIndexHandler({}, 'note-1', 'x'.repeat(1025), 'content')).resolves.toBe(false)
    await expect(checkIndexHandler({}, 'note-1', 'nb-1', 'content\0bad')).resolves.toBe(false)
    await expect(restoreHandler({}, '   ')).resolves.toBe(false)
    await expect(permanentDeleteHandler({}, 42)).resolves.toBe(false)
    expect(deps.checkAndIndex).not.toHaveBeenCalled()
    expect(deps.restoreNote).not.toHaveBeenCalled()
    expect(deps.permanentlyDeleteNote).not.toHaveBeenCalled()
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
