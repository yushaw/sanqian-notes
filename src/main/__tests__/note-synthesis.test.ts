import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ensureLocalNoteIdentityMock,
  ensureLocalNoteIdentitiesBatchMock,
  getLocalFolderMountsMock,
  getNotesMock,
  listLocalNoteIdentityMock,
  listLocalNoteMetadataMock,
  readLocalFolderFileAsyncMock,
  resolveNoteResourceAsyncMock,
  buildNoteFromResolvedResourceMock,
} = vi.hoisted(() => ({
  ensureLocalNoteIdentityMock: vi.fn(),
  ensureLocalNoteIdentitiesBatchMock: vi.fn(),
  getLocalFolderMountsMock: vi.fn(),
  getNotesMock: vi.fn(),
  listLocalNoteIdentityMock: vi.fn(),
  listLocalNoteMetadataMock: vi.fn(),
  readLocalFolderFileAsyncMock: vi.fn(),
  resolveNoteResourceAsyncMock: vi.fn(),
  buildNoteFromResolvedResourceMock: vi.fn(),
}))

vi.mock('../database', () => ({
  ensureLocalNoteIdentity: ensureLocalNoteIdentityMock,
  ensureLocalNoteIdentitiesBatch: ensureLocalNoteIdentitiesBatchMock,
  getLocalFolderMounts: getLocalFolderMountsMock,
  getNotes: getNotesMock,
  listLocalNoteIdentity: listLocalNoteIdentityMock,
  listLocalNoteMetadata: listLocalNoteMetadataMock,
}))

vi.mock('../local-folder', () => ({
  readLocalFolderFileAsync: readLocalFolderFileAsyncMock,
}))

vi.mock('../local-folder/cache', () => ({
  yieldToEventLoop: vi.fn(async () => undefined),
}))

vi.mock('../local-note-tags', () => ({
  extractLocalTagNamesFromTiptapContent: vi.fn(() => ['tag-local']),
  mergeLocalUserAndAITagNames: vi.fn((userTags?: string[], aiTags?: string[]) => {
    const values = new Set<string>([...(userTags || []), ...(aiTags || [])])
    return Array.from(values).map((name) => ({ name }))
  }),
}))

vi.mock('../note-gateway', () => ({
  resolveNoteResource: vi.fn(),
  resolveNoteResourceAsync: resolveNoteResourceAsyncMock,
  buildNoteFromResolvedResource: buildNoteFromResolvedResourceMock,
}))

import {
  collectLocalNotesForGetAllAsync,
  EMPTY_TIPTAP_DOC,
  getNoteByIdForRendererAsync,
  getNotesByIdsForRendererAsync,
  initNoteSynthesis,
} from '../note-synthesis'

function createMount() {
  const now = '2026-04-08T00:00:00.000Z'
  return {
    notebook: {
      id: 'nb-local',
      name: 'Local Notebook',
      icon: 'logo:notes',
      source_type: 'local-folder' as const,
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: 'nb-local',
      root_path: '/tmp/local-notes',
      canonical_root_path: '/tmp/local-notes',
      status: 'active' as const,
      created_at: now,
      updated_at: now,
    },
  }
}

function createTree() {
  const nowMs = Date.parse('2026-04-08T00:00:00.000Z')
  return {
    notebook_id: 'nb-local',
    root_path: '/tmp/local-notes',
    scanned_at: '2026-04-08T00:00:00.000Z',
    tree: [],
    files: [
      {
        id: 'file-1',
        name: 'Alpha',
        file_name: 'alpha.md',
        relative_path: 'alpha.md',
        folder_relative_path: '',
        folder_depth: 1,
        extension: 'md' as const,
        size: 12,
        mtime_ms: nowMs,
        root_path: '/tmp/local-notes',
      },
      {
        id: 'file-2',
        name: 'Beta',
        file_name: 'beta.md',
        relative_path: 'beta.md',
        folder_relative_path: '',
        folder_depth: 1,
        extension: 'md' as const,
        size: 14,
        mtime_ms: nowMs + 1000,
        root_path: '/tmp/local-notes',
      },
    ],
  }
}

describe('note-synthesis local folder synthesis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getNotesMock.mockReturnValue([])
    getLocalFolderMountsMock.mockReturnValue([createMount()])
    listLocalNoteMetadataMock.mockReturnValue([])
    listLocalNoteIdentityMock.mockReturnValue([])
    ensureLocalNoteIdentityMock.mockImplementation(({ notebook_id, relative_path }) => ({
      note_uid: `${notebook_id}:${relative_path}`,
      notebook_id,
      relative_path,
      created_at: '2026-04-08T00:00:00.000Z',
      updated_at: '2026-04-08T00:00:00.000Z',
    }))
    ensureLocalNoteIdentitiesBatchMock.mockImplementation(({ notebook_id, relative_paths }) => {
      const map = new Map<string, { note_uid: string }>()
      for (const relativePath of relative_paths as string[]) {
        map.set(relativePath, { note_uid: `${notebook_id}:${relativePath}` })
      }
      return map
    })
    readLocalFolderFileAsyncMock.mockResolvedValue({
      success: true,
      result: {
        id: 'local:mock',
        notebook_id: 'nb-local',
        name: 'Alpha',
        file_name: 'alpha.md',
        relative_path: 'alpha.md',
        extension: 'md' as const,
        size: 12,
        mtime_ms: Date.parse('2026-04-08T00:00:00.000Z'),
        content_hash: 'hash',
        tiptap_content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"alpha"}]}]}',
      },
    })
    buildNoteFromResolvedResourceMock.mockImplementation((resource: { id: string }) => createNoteFromResource(resource.id))

    initNoteSynthesis({
      getCachedLocalFolderTree: vi.fn(() => createTree()),
      scanAndCacheLocalFolderTree: vi.fn(),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => createTree()),
      searchScanCacheTtlMs: 2000,
    })
  })

  it('batch-ensures local identities when synthesizing local notes list', async () => {
    const notes = await collectLocalNotesForGetAllAsync({
      includeLocal: true,
      includeLocalContent: false,
    })

    expect(ensureLocalNoteIdentitiesBatchMock).toHaveBeenCalledTimes(1)
    expect(ensureLocalNoteIdentitiesBatchMock).toHaveBeenCalledWith({
      notebook_id: 'nb-local',
      relative_paths: ['alpha.md', 'beta.md'],
    })
    expect(ensureLocalNoteIdentityMock).not.toHaveBeenCalled()
    expect(notes).toHaveLength(2)
    expect(notes[0].content).toBe(EMPTY_TIPTAP_DOC)
  })

  it('falls back to single-path ensure when batch ensure throws', async () => {
    ensureLocalNoteIdentitiesBatchMock.mockImplementation(() => {
      throw new Error('batch failed')
    })

    const notes = await collectLocalNotesForGetAllAsync({
      includeLocal: true,
      includeLocalContent: false,
    })

    expect(ensureLocalNoteIdentityMock).toHaveBeenCalledTimes(2)
    expect(ensureLocalNoteIdentityMock).toHaveBeenCalledWith({
      notebook_id: 'nb-local',
      relative_path: 'alpha.md',
    })
    expect(ensureLocalNoteIdentityMock).toHaveBeenCalledWith({
      notebook_id: 'nb-local',
      relative_path: 'beta.md',
    })
    expect(notes).toHaveLength(2)
  })

  it('reads local note content through async file reader when includeLocalContent is enabled', async () => {
    listLocalNoteIdentityMock.mockReturnValue([
      {
        note_uid: 'nb-local:alpha.md',
        notebook_id: 'nb-local',
        relative_path: 'alpha.md',
        created_at: '2026-04-08T00:00:00.000Z',
        updated_at: '2026-04-08T00:00:00.000Z',
      },
      {
        note_uid: 'nb-local:beta.md',
        notebook_id: 'nb-local',
        relative_path: 'beta.md',
        created_at: '2026-04-08T00:00:00.000Z',
        updated_at: '2026-04-08T00:00:00.000Z',
      },
    ])
    readLocalFolderFileAsyncMock
      .mockResolvedValueOnce({
        success: true,
        result: {
          id: 'local:alpha',
          notebook_id: 'nb-local',
          name: 'Alpha',
          file_name: 'alpha.md',
          relative_path: 'alpha.md',
          extension: 'md' as const,
          size: 12,
          mtime_ms: Date.parse('2026-04-08T00:00:00.000Z'),
          content_hash: 'hash-alpha',
          tiptap_content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"alpha"}]}]}',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        result: {
          id: 'local:beta',
          notebook_id: 'nb-local',
          name: 'Beta',
          file_name: 'beta.md',
          relative_path: 'beta.md',
          extension: 'md' as const,
          size: 14,
          mtime_ms: Date.parse('2026-04-08T00:00:01.000Z'),
          content_hash: 'hash-beta',
          tiptap_content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"beta"}]}]}',
        },
      })

    const notes = await collectLocalNotesForGetAllAsync({
      includeLocal: true,
      includeLocalContent: true,
    })

    expect(readLocalFolderFileAsyncMock).toHaveBeenCalledTimes(2)
    expect(readLocalFolderFileAsyncMock).toHaveBeenCalledWith(expect.any(Object), 'alpha.md')
    expect(readLocalFolderFileAsyncMock).toHaveBeenCalledWith(expect.any(Object), 'beta.md')
    expect(notes).toHaveLength(2)
    expect(notes[0].content).toContain('alpha')
    expect(notes[1].content).toContain('beta')
  })

  it('resolves single note by id through async note-gateway path', async () => {
    resolveNoteResourceAsyncMock.mockResolvedValueOnce({
      ok: true,
      resource: { id: 'local:nb-local:alpha.md', sourceType: 'local-folder' },
    })

    const note = await getNoteByIdForRendererAsync('local:nb-local:alpha.md')

    expect(resolveNoteResourceAsyncMock).toHaveBeenCalledWith('local:nb-local:alpha.md')
    expect(buildNoteFromResolvedResourceMock).toHaveBeenCalledTimes(1)
    expect(note?.id).toBe('local:nb-local:alpha.md')
  })

  it('resolves note list by ids through async note-gateway path', async () => {
    resolveNoteResourceAsyncMock
      .mockResolvedValueOnce({
        ok: true,
        resource: { id: 'note-1', sourceType: 'internal' },
      })
      .mockResolvedValueOnce({
        ok: false,
        errorCode: 'NOTE_NOT_FOUND',
      })
      .mockResolvedValueOnce({
        ok: true,
        resource: { id: 'note-3', sourceType: 'internal' },
      })

    const notes = await getNotesByIdsForRendererAsync(['note-1', 'missing', 'note-3'])

    expect(resolveNoteResourceAsyncMock).toHaveBeenCalledTimes(3)
    expect(notes.map((item) => item.id)).toEqual(['note-1', 'note-3'])
  })
})

function createNoteFromResource(id: string) {
  const now = '2026-04-08T00:00:00.000Z'
  return {
    id,
    title: id,
    content: EMPTY_TIPTAP_DOC,
    notebook_id: 'nb-local',
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ai_summary: null,
    tags: [],
  }
}
