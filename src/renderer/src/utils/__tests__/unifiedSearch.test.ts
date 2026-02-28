import { describe, expect, it, vi } from 'vitest'
import type { LocalFolderSearchResponse, LocalNoteMetadata, Note, Notebook, NoteSearchFilter } from '../../types/note'
import { runUnifiedSearch } from '../unifiedSearch'

const now = '2026-02-25T12:00:00.000Z'

function createInternalNote(id: string, updatedAt: string): Note {
  return {
    id,
    title: id,
    content: '[]',
    notebook_id: null,
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 1,
    created_at: now,
    updated_at: updatedAt,
    deleted_at: null,
    ai_summary: null,
    tags: [],
  }
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('runUnifiedSearch', () => {
  it('returns empty for local notebook search context', async () => {
    const searchInternal = vi.fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>()
    const notebooks: Notebook[] = [
      {
        id: 'local-nb',
        name: 'Local',
        source_type: 'local-folder',
        order_index: 0,
        created_at: now,
      },
    ]

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: 'local-nb',
      selectedSmartView: null,
      notebooks,
      searchInternal,
      searchLocal,
    })

    expect(result).toEqual([])
    expect(searchInternal).not.toHaveBeenCalled()
    expect(searchLocal).not.toHaveBeenCalled()
  })

  it('searches only internal notes when notebook is selected', async () => {
    const internalNotes = [createInternalNote('n-1', '2026-02-25T09:00:00.000Z')]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>()
    const notebooks: Notebook[] = [
      {
        id: 'internal-nb',
        name: 'Internal',
        source_type: 'internal',
        order_index: 0,
        created_at: now,
      },
    ]

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: 'internal-nb',
      selectedSmartView: null,
      notebooks,
      searchInternal,
      searchLocal,
    })

    expect(searchInternal).toHaveBeenCalledWith('agent', { notebookId: 'internal-nb' })
    expect(searchLocal).not.toHaveBeenCalled()
    expect(result).toEqual(internalNotes)
  })

  it('merges internal and local results for global all view', async () => {
    const internalNotes = [createInternalNote('n-1', '2026-02-25T09:00:00.000Z')]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>().mockResolvedValue({
      success: true,
      result: {
        hits: [
          {
            notebook_id: 'local-nb',
            relative_path: 'folder/alpha.md',
            canonical_path: '/vault/folder/alpha.md',
            score: 10,
            mtime_ms: Date.parse('2026-02-25T10:00:00.000Z'),
            snippet: 'alpha',
          },
        ],
      },
    })
    const notebooks: Notebook[] = [
      {
        id: 'local-nb',
        name: 'Local',
        source_type: 'local-folder',
        order_index: 0,
        created_at: now,
      },
    ]

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: 'all',
      notebooks,
      searchInternal,
      searchLocal,
    })

    expect(searchInternal).toHaveBeenCalledWith('agent', { viewType: 'all' })
    expect(searchLocal).toHaveBeenCalledWith('agent')
    expect(result.map((note) => note.id)).toEqual(['n-1', 'local:local-nb:folder%2Falpha.md'])
  })

  it('propagates local metadata into merged global search results', async () => {
    const internalNotes = [createInternalNote('n-1', '2026-02-25T09:00:00.000Z')]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>().mockResolvedValue({
      success: true,
      result: {
        hits: [
          {
            notebook_id: 'local-nb',
            relative_path: 'folder/alpha.md',
            canonical_path: '/vault/folder/alpha.md',
            score: 10,
            mtime_ms: Date.parse('2026-02-25T10:00:00.000Z'),
            snippet: 'alpha',
          },
        ],
      },
    })
    const metadataById: Record<string, LocalNoteMetadata> = {
      'local:local-nb:folder%2Falpha.md': {
        notebook_id: 'local-nb',
        relative_path: 'folder/alpha.md',
        is_favorite: true,
        is_pinned: false,
        ai_summary: 'metadata summary',
        updated_at: now,
      },
    }

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: 'all',
      notebooks: [{
        id: 'local-nb',
        name: 'Local',
        source_type: 'local-folder',
        order_index: 0,
        created_at: now,
      }],
      localNoteMetadataById: metadataById,
      searchInternal,
      searchLocal,
    })

    expect(result[1]?.id).toBe('local:local-nb:folder%2Falpha.md')
    expect(result[1]?.is_favorite).toBe(true)
    expect(result[1]?.ai_summary).toBe('metadata summary')
  })

  it('searches local results for favorites smart view', async () => {
    const internalNotes = [createInternalNote('n-1', '2026-02-25T09:00:00.000Z')]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>().mockResolvedValue({
      success: true,
      result: {
        hits: [
          {
            notebook_id: 'local-nb',
            relative_path: 'fav.md',
            canonical_path: '/vault/fav.md',
            score: 10,
            mtime_ms: Date.parse('2026-02-25T10:00:00.000Z'),
            snippet: 'fav',
          },
          {
            notebook_id: 'local-nb',
            relative_path: 'normal.md',
            canonical_path: '/vault/normal.md',
            score: 9,
            mtime_ms: Date.parse('2026-02-25T09:00:00.000Z'),
            snippet: 'normal',
          },
        ],
      },
    })
    const metadataById: Record<string, LocalNoteMetadata> = {
      'local:local-nb:fav.md': {
        notebook_id: 'local-nb',
        relative_path: 'fav.md',
        is_favorite: true,
        is_pinned: false,
        ai_summary: null,
        updated_at: now,
      },
    }

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: 'favorites',
      notebooks: [{
        id: 'local-nb',
        name: 'Local',
        source_type: 'local-folder',
        order_index: 0,
        created_at: now,
      }],
      localNoteMetadataById: metadataById,
      searchInternal,
      searchLocal,
    })

    expect(searchInternal).toHaveBeenCalledWith('agent', { viewType: 'favorites' })
    expect(searchLocal).toHaveBeenCalledWith('agent')
    expect(result.map((note) => note.id)).toEqual(['n-1', 'local:local-nb:fav.md'])
  })

  it('skips local search for daily smart view', async () => {
    const internalNotes = [createInternalNote('n-1', '2026-02-25T09:00:00.000Z')]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>()

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: 'daily',
      notebooks: [],
      searchInternal,
      searchLocal,
    })

    expect(searchInternal).toHaveBeenCalledWith('agent', { viewType: 'daily' })
    expect(searchLocal).not.toHaveBeenCalled()
    expect(result).toEqual(internalNotes)
  })

  it('falls back to internal results when local search fails', async () => {
    const internalNotes = [createInternalNote('n-1', '2026-02-25T09:00:00.000Z')]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>().mockResolvedValue({
      success: false,
      errorCode: 'LOCAL_FILE_UNREADABLE',
    })

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: null,
      notebooks: [],
      searchInternal,
      searchLocal,
    })

    expect(searchInternal).toHaveBeenCalledWith('agent', { viewType: 'all' })
    expect(searchLocal).toHaveBeenCalledWith('agent')
    expect(result).toEqual(internalNotes)
  })

  it('starts internal and local searches in parallel for global search', async () => {
    const internalDeferred = createDeferredPromise<Note[]>()
    const localDeferred = createDeferredPromise<LocalFolderSearchResponse>()
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockImplementation(() => internalDeferred.promise)
    const searchLocal = vi
      .fn<(query: string) => Promise<LocalFolderSearchResponse>>()
      .mockImplementation(() => localDeferred.promise)

    const pending = runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: 'all',
      notebooks: [],
      searchInternal,
      searchLocal,
    })

    expect(searchInternal).toHaveBeenCalledTimes(1)
    expect(searchLocal).toHaveBeenCalledTimes(1)

    internalDeferred.resolve([createInternalNote('n-1', '2026-02-25T09:00:00.000Z')])
    localDeferred.resolve({
      success: true,
      result: { hits: [] },
    })

    const result = await pending
    expect(result.map((note) => note.id)).toEqual(['n-1'])
  })

  it('falls back to internal results when local search throws', async () => {
    const internalNotes = [createInternalNote('n-1', '2026-02-25T09:00:00.000Z')]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi
      .fn<(query: string) => Promise<LocalFolderSearchResponse>>()
      .mockRejectedValue(new Error('network unavailable'))

    const result = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: null,
      notebooks: [],
      searchInternal,
      searchLocal,
    })

    expect(result).toEqual(internalNotes)
  })

  it('keeps global result ordering stable across repeated queries', async () => {
    const internalNotes = [
      createInternalNote('n-2', '2026-02-25T09:00:00.000Z'),
      createInternalNote('n-1', '2026-02-25T09:00:00.000Z'),
    ]
    const searchInternal = vi
      .fn<(query: string, filter: NoteSearchFilter) => Promise<Note[]>>()
      .mockResolvedValue(internalNotes)
    const searchLocal = vi.fn<(query: string) => Promise<LocalFolderSearchResponse>>().mockResolvedValue({
      success: true,
      result: {
        hits: [
          {
            notebook_id: 'local-nb',
            relative_path: 'b.md',
            canonical_path: '/vault/b.md',
            score: 10,
            mtime_ms: Date.parse('2026-02-25T09:00:00.000Z'),
            snippet: 'b',
          },
          {
            notebook_id: 'local-nb',
            relative_path: 'a.md',
            canonical_path: '/vault/a.md',
            score: 10,
            mtime_ms: Date.parse('2026-02-25T09:00:00.000Z'),
            snippet: 'a',
          },
        ],
      },
    })
    const notebooks: Notebook[] = [
      {
        id: 'local-nb',
        name: 'Local',
        source_type: 'local-folder',
        order_index: 0,
        created_at: now,
      },
    ]

    const first = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: 'all',
      notebooks,
      searchInternal,
      searchLocal,
    })
    const second = await runUnifiedSearch({
      query: 'agent',
      selectedNotebookId: null,
      selectedSmartView: 'all',
      notebooks,
      searchInternal,
      searchLocal,
    })

    expect(first.map((note) => note.id)).toEqual(second.map((note) => note.id))
  })
})
