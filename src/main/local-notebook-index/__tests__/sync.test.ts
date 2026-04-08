import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LocalFolderNotebookMount, LocalFolderTreeResult } from '../../../shared/types'

// --- Mocks ---

vi.mock('../../database', () => ({
  getLocalFolderMounts: vi.fn(),
  getLocalNoteIdentityByPath: vi.fn(),
  listLocalNoteIdentity: vi.fn(),
  ensureLocalNoteIdentity: vi.fn(),
  ensureLocalNoteIdentitiesBatch: vi.fn(),
}))
vi.mock('../../local-folder', () => ({
  readLocalFolderFileAsync: vi.fn(),
  statLocalFolderFileAsync: vi.fn(),
  scanLocalFolderMountForSearchAsync: vi.fn(),
}))
vi.mock('../../local-note-state-cleanup', () => ({
  cleanupMissingLocalNoteState: vi.fn(),
}))
vi.mock('../../local-folder-tree-cache', () => ({
  getCachedLocalFolderTree: vi.fn(),
  invalidateLocalFolderTreeCache: vi.fn(),
}))
vi.mock('../../embedding', () => ({
  indexingService: {
    checkAndIndex: vi.fn().mockResolvedValue(true),
    deleteNoteIndex: vi.fn(),
  },
  getNoteIndexStatusBatch: vi.fn(),
  updateNoteIndexFileMtimeIfIndexed: vi.fn().mockReturnValue(false),
}))
vi.mock('../helpers', () => ({
  normalizeLocalIndexSyncPath: vi.fn(),
  resolveLocalIndexNoteId: vi.fn(),
  collectIndexedLocalNoteIdsByNotebook: vi.fn(),
  deleteIndexedLocalNotesByNotebook: vi.fn(),
  deleteIndexForLocalPath: vi.fn(),
  syncLocalNoteTagsMetadata: vi.fn(),
  syncLocalNoteTagsMetadataBatch: vi.fn(),
  syncLocalNotePopupRefs: vi.fn(),
  syncLocalNotePopupRefsBatch: vi.fn(),
  deleteLocalNoteMetadataByPath: vi.fn(),
  deleteLocalNoteIdentityByPath: vi.fn(),
}))
vi.mock('../knowledge-base-rebuild', () => ({
  isKnowledgeBaseRebuilding: vi.fn().mockReturnValue(false),
}))

import {
  getLocalFolderMounts,
  getLocalNoteIdentityByPath,
  listLocalNoteIdentity,
  ensureLocalNoteIdentity,
  ensureLocalNoteIdentitiesBatch,
} from '../../database'
import {
  readLocalFolderFileAsync,
  statLocalFolderFileAsync,
  scanLocalFolderMountForSearchAsync,
} from '../../local-folder'
import { getCachedLocalFolderTree } from '../../local-folder-tree-cache'
import { cleanupMissingLocalNoteState } from '../../local-note-state-cleanup'
import { indexingService, getNoteIndexStatusBatch, updateNoteIndexFileMtimeIfIndexed } from '../../embedding'
import {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNoteTagsMetadataBatch,
  syncLocalNotePopupRefs,
  syncLocalNotePopupRefsBatch,
  deleteLocalNoteMetadataByPath,
  deleteLocalNoteIdentityByPath,
} from '../helpers'
import { isKnowledgeBaseRebuilding } from '../knowledge-base-rebuild'

import {
  enqueueLocalNotebookIndexSync,
  cancelPendingLocalNotebookIndexSync,
  hasPendingIndexSync,
  hasPendingFullIndexSyncForNotebook,
  clearLocalNotebookIndexSyncForNotebook,
  rebuildLocalNotebookIndexesAfterInternalRebuild,
  resetLocalNotebookIndexSyncState,
  flushQueuedLocalNotebookIndexSync,
} from '../sync'

// --- Helpers ---

function createMount(overrides: Partial<LocalFolderNotebookMount> = {}): LocalFolderNotebookMount {
  return {
    notebook: { id: 'nb-1', name: 'Test', icon: 'logo:notes', source_type: 'local-folder', order_index: 0, created_at: '2026-01-01' },
    mount: { root_path: '/tmp/test', canonical_root_path: '/tmp/test', status: 'active' },
    ...overrides,
  } as LocalFolderNotebookMount
}

function createTree(files: { relative_path: string }[]): LocalFolderTreeResult {
  return {
    notebook_id: 'nb-1',
    files: files.map((f) => ({ relative_path: f.relative_path, mtime_ms: 1000, size: 100 })),
    folders: [],
  } as unknown as LocalFolderTreeResult
}

beforeEach(() => {
  vi.clearAllMocks()
  cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
  resetLocalNotebookIndexSyncState()

  // Default: normalize returns input as-is
  vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
  vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
  vi.mocked(isKnowledgeBaseRebuilding).mockReturnValue(false)
  vi.mocked(indexingService.checkAndIndex).mockResolvedValue(true)
  vi.mocked(getCachedLocalFolderTree).mockReturnValue(null)
  vi.mocked(statLocalFolderFileAsync).mockReturnValue({
    success: true,
    result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
  } as any)
  vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
    relative_path ? ({ note_uid: `uid:${relative_path}` } as any) : null
  ))
  vi.mocked(listLocalNoteIdentity).mockReturnValue([])
  vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
    const ensured = new Map<string, any>()
    for (const relativePath of relative_paths || []) {
      ensured.set(relativePath, {
        note_uid: `uid:${relativePath}`,
        notebook_id: 'nb-1',
        relative_path: relativePath,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
    }
    return ensured
  })
  vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
  vi.mocked(updateNoteIndexFileMtimeIfIndexed).mockReturnValue(false)
})

afterEach(() => {
  cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
  resetLocalNotebookIndexSyncState()
})

// --- Incremental sync ---

describe('incremental sync (request.full === false)', () => {
  const mount = createMount()

  beforeEach(() => {
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
  })

  it('skips when paths set is empty', async () => {
    vi.useFakeTimers()
    enqueueLocalNotebookIndexSync('nb-1', { immediate: true })
    await vi.advanceTimersByTimeAsync(10)
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reads files and syncs tags + popup refs (no FTS/checkAndIndex)', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"content":"test"}', mtime_ms: 1000, size: 50 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'foo.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'foo.md')
    expect(ensureLocalNoteIdentity).toHaveBeenCalledWith({ notebook_id: 'nb-1', relative_path: 'foo.md' })
    expect(syncLocalNoteTagsMetadata).toHaveBeenCalledWith('nb-1', 'foo.md', '{"content":"test"}')
    expect(syncLocalNotePopupRefs).toHaveBeenCalledWith('nb-1', 'foo.md', '{"content":"test"}', {
      noteUid: 'uid:foo.md',
    })
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('falls back to path-based local ID when ensureLocalNoteIdentity throws in force-index incremental sync', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockReturnValue(new Map())
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(() => {
      throw new Error('ensure identity failed')
    })
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"content":"force"}', mtime_ms: 1000, size: 50 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePath: 'foo.md',
      forceIndexForPaths: true,
      immediate: true,
    })
    await vi.advanceTimersByTimeAsync(20)

    expect(indexingService.checkAndIndex).toHaveBeenCalledWith(
      'uid:foo.md',
      'nb-1',
      '{"content":"force"}',
      { ftsOnly: true, fileMtimeMs: 1000, existingStatus: null }
    )
    expect(syncLocalNotePopupRefs).toHaveBeenCalledWith('nb-1', 'foo.md', '{"content":"force"}', {
      noteUid: null,
    })
    vi.useRealTimers()
  })

  it('handles file read failure and deletes index + metadata for specific error codes', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({ note_uid: 'uid-old' } as any)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: false,
      errorCode: 'LOCAL_FILE_NOT_FOUND',
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'deleted.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'deleted.md', { noteUid: 'uid-old' })
    expect(deleteLocalNoteMetadataByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'deleted.md',
      kind: 'file',
    })
    expect(deleteLocalNoteIdentityByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'deleted.md',
      kind: 'file',
    })
    vi.useRealTimers()
  })

  it('does not delete metadata for non-specific error codes', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: false,
      errorCode: 'LOCAL_FILE_UNREADABLE',
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'broken.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(deleteIndexForLocalPath).toHaveBeenCalled()
    expect(deleteLocalNoteMetadataByPath).not.toHaveBeenCalled()
    expect(deleteLocalNoteIdentityByPath).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('skips content read and cleans up metadata when force-index stat precheck reports file missing', async () => {
    vi.useFakeTimers()
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map([
      ['uid:a.md', {
        noteId: 'uid:a.md',
        contentHash: 'h1',
        chunkCount: 1,
        modelName: '',
        indexedAt: '2026-03-01T00:00:00.000Z',
        status: 'indexed',
        ftsStatus: 'indexed',
        embeddingStatus: 'none',
        fileMtime: new Date(1000).toISOString(),
      }],
      ['uid:b.md', {
        noteId: 'uid:b.md',
        contentHash: 'h2',
        chunkCount: 1,
        modelName: '',
        indexedAt: '2026-03-01T00:00:00.000Z',
        status: 'indexed',
        ftsStatus: 'indexed',
        embeddingStatus: 'none',
        fileMtime: new Date(1000).toISOString(),
      }],
    ]))
    vi.mocked(statLocalFolderFileAsync).mockImplementation(async (_mount, relativePath) => {
      if (relativePath === 'a.md') {
        return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' } as any
      }
      return {
        success: true,
        result: { relative_path: relativePath, mtime_ms: 2000, size: 100 },
      } as any
    })
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"content":"b"}', mtime_ms: 2000, size: 100 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: ['a.md', 'b.md'],
      forceIndexForPaths: true,
      immediate: true,
    })
    await vi.advanceTimersByTimeAsync(20)

    expect(statLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'a.md')
    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'a.md', { noteUid: 'uid:a.md' })
    expect(deleteLocalNoteMetadataByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'a.md',
      kind: 'file',
    })
    expect(deleteLocalNoteIdentityByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'a.md',
      kind: 'file',
    })
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('deletes indexed notes when mount is not found', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([])

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'foo.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith('nb-1')
    vi.useRealTimers()
  })

  it('deletes indexed notes when mount status is not active', async () => {
    vi.useFakeTimers()
    const inactiveMount = createMount({
      mount: { root_path: '/tmp/test', canonical_root_path: '/tmp/test', status: 'missing' } as any,
    })
    vi.mocked(getLocalFolderMounts).mockReturnValue([inactiveMount])

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'foo.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith('nb-1')
    vi.useRealTimers()
  })
})

// --- Full sync ---

describe('full sync (request.full === true)', () => {
  const mount = createMount()

  beforeEach(() => {
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
  })

  it('scans tree, reuses existing identities, resolves local IDs, and indexes files', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }, { relative_path: 'b.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(listLocalNoteIdentity).mockReturnValue([
      {
        note_uid: 'uid:a.md',
        notebook_id: 'nb-1',
        relative_path: 'a.md',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        note_uid: 'uid:b.md',
        notebook_id: 'nb-1',
        relative_path: 'b.md',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ] as any)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledWith(mount, { sortEntries: false })
    expect(ensureLocalNoteIdentity).not.toHaveBeenCalled()
    expect(cleanupMissingLocalNoteState).toHaveBeenCalledWith(
      'nb-1',
      new Set(['a.md', 'b.md']),
      normalizeLocalIndexSyncPath
    )
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('falls back to on-demand identity ensure when full-sync preloaded identity is missing', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(ensureLocalNoteIdentity).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'a.md',
    })
    expect(indexingService.checkAndIndex).toHaveBeenCalledWith(
      'uid:a.md',
      'nb-1',
      '{"doc":true}',
      { ftsOnly: true, fileMtimeMs: 1000, existingStatus: null }
    )
    expect(syncLocalNotePopupRefsBatch).toHaveBeenCalledWith({
      updates: [{ noteUid: 'uid:a.md', tiptapContent: '{"doc":true}' }],
    })
    vi.useRealTimers()
  })

  it('falls back to batch identity ensure when identity listing fails during full sync', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set(['uid:a.md']))
    vi.mocked(listLocalNoteIdentity).mockImplementation(() => {
      throw new Error('list identity failed')
    })
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, any>()
      for (const relativePath of relative_paths || []) {
        ensured.set(relativePath, {
          note_uid: `uid:${relativePath}`,
          notebook_id: 'nb-1',
          relative_path: relativePath,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        })
      }
      return ensured
    })
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map([
      ['uid:a.md', {
        noteId: 'uid:a.md',
        contentHash: 'hash',
        chunkCount: 1,
        modelName: '',
        indexedAt: '2026-03-01T00:00:00.000Z',
        status: 'indexed',
        ftsStatus: 'indexed',
        embeddingStatus: 'none',
        fileMtime: new Date(1000).toISOString(),
      }],
    ]))

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(ensureLocalNoteIdentitiesBatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_paths: ['a.md'],
    })
    expect(indexingService.deleteNoteIndex).not.toHaveBeenCalledWith('uid:a.md')
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('deletes path-based indexed ID when on-demand full-sync ensure upgrades to uid ID', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set(['uid:a.md']))
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path === 'a.md'
        ? ({ note_uid: 'uid:ensured:a.md' } as any)
        : null
    ))
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uid:a.md')
    expect(indexingService.checkAndIndex).toHaveBeenCalledWith(
      'uid:ensured:a.md',
      'nb-1',
      '{"doc":true}',
      { ftsOnly: true, fileMtimeMs: 1000, existingStatus: null }
    )
    vi.useRealTimers()
  })

  it('deletes stale indexed IDs not in current tree', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set(['uid:a.md', 'stale-id']))
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('stale-id')
    vi.useRealTimers()
  })

  it('skips full indexing when mtime is unchanged and status is already indexed', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set(['uid:a.md']))
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map([
      ['uid:a.md', {
        noteId: 'uid:a.md',
        contentHash: 'hash',
        chunkCount: 1,
        modelName: '',
        indexedAt: '2026-03-01T00:00:00.000Z',
        status: 'indexed',
        ftsStatus: 'indexed',
        embeddingStatus: 'none',
        fileMtime: new Date(1000).toISOString(),
      }],
    ]))

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('backfills missing mtime without reading file when indexedAt is newer than file mtime', async () => {
    vi.useFakeTimers()
    const mtimeMs = Date.parse('2026-02-01T00:00:00.000Z')
    const tree = {
      notebook_id: 'nb-1',
      files: [{ relative_path: 'a.md', mtime_ms: mtimeMs, size: 100 }],
      folders: [],
    } as unknown as LocalFolderTreeResult
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set(['uid:a.md']))
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map([
      ['uid:a.md', {
        noteId: 'uid:a.md',
        contentHash: 'hash',
        chunkCount: 1,
        modelName: '',
        indexedAt: '2026-03-01T00:00:00.000Z',
        status: 'indexed',
        ftsStatus: 'indexed',
        embeddingStatus: 'none',
      }],
    ]))
    vi.mocked(updateNoteIndexFileMtimeIfIndexed).mockReturnValue(true)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(updateNoteIndexFileMtimeIfIndexed).toHaveBeenCalledWith(
      'uid:a.md',
      '2026-02-01T00:00:00.000Z'
    )
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('indexes with ftsOnly: true and fileMtimeMs', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 2000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(indexingService.checkAndIndex).toHaveBeenCalledWith(
      'uid:a.md',
      'nb-1',
      '{"doc":true}',
      { ftsOnly: true, fileMtimeMs: 2000, existingStatus: null }
    )
    vi.useRealTimers()
  })

  it('deletes index without pruning metadata when file read fails as unreadable during full sync', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'bad.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'bad.md', { noteUid: 'uid:bad.md' })
    expect(deleteLocalNoteMetadataByPath).not.toHaveBeenCalled()
    expect(deleteLocalNoteIdentityByPath).not.toHaveBeenCalled()
    expect(indexingService.deleteNoteIndex).not.toHaveBeenCalled()
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('deletes index and prunes metadata when file read reports not found during full sync', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'gone.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'gone.md', { noteUid: 'uid:gone.md' })
    expect(deleteLocalNoteMetadataByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'gone.md',
      kind: 'file',
    })
    expect(deleteLocalNoteIdentityByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'gone.md',
      kind: 'file',
    })
    vi.useRealTimers()
  })

  it('handles tree scan failure with early return', async () => {
    vi.useFakeTimers()
    vi.mocked(scanLocalFolderMountForSearchAsync).mockImplementation(() => { throw new Error('scan failed') })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(collectIndexedLocalNoteIdsByNotebook).not.toHaveBeenCalled()
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
    warnSpy.mockRestore()
    vi.useRealTimers()
  })

  it('syncs tags and popup refs for each file during full sync', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'note.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"text":"hello"}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(syncLocalNoteTagsMetadata).not.toHaveBeenCalled()
    expect(syncLocalNotePopupRefs).not.toHaveBeenCalled()
    expect(syncLocalNoteTagsMetadataBatch).toHaveBeenCalledWith({
      notebookId: 'nb-1',
      updates: [{ relativePath: 'note.md', tiptapContent: '{"text":"hello"}' }],
    })
    expect(syncLocalNotePopupRefsBatch).toHaveBeenCalledWith({
      updates: [{ noteUid: 'uid:note.md', tiptapContent: '{"text":"hello"}' }],
    })
    vi.useRealTimers()
  })

})

// --- Scheduling and debounce ---

describe('scheduling and debounce', () => {
  const mount = createMount()

  beforeEach(() => {
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
  })

  it('merges paths for the same notebook', async () => {
    vi.useFakeTimers()
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'b.md' })
    await vi.advanceTimersByTimeAsync(1000)

    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'a.md')
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'b.md')
    vi.useRealTimers()
  })

  it('accepts batched changedRelativePaths and merges them into one request', async () => {
    vi.useFakeTimers()
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: ['a.md', 'b.md', 'a.md'],
      immediate: true,
    })
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'a.md')
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'b.md')
    vi.useRealTimers()
  })

  it('full: true upgrades existing request', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    enqueueLocalNotebookIndexSync('nb-1', { full: true })
    await vi.advanceTimersByTimeAsync(1000)

    // Full sync path: file scan is called
    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('debounces with 900ms default delay', async () => {
    vi.useFakeTimers()
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })

    // Not yet fired at 800ms
    await vi.advanceTimersByTimeAsync(800)
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()

    // Fires at 900ms
    await vi.advanceTimersByTimeAsync(200)
    expect(readLocalFolderFileAsync).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('fires immediately when immediate: true', async () => {
    vi.useFakeTimers()
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFileAsync).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not schedule when knowledge base is rebuilding', () => {
    vi.useFakeTimers()
    vi.mocked(isKnowledgeBaseRebuilding).mockReturnValue(true)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md', immediate: true })

    // Even though the request is queued, the timer should not fire the sync
    // because scheduleLocalNotebookIndexSync returns early when rebuilding
    expect(hasPendingIndexSync()).toBe(true) // request is queued
    vi.useRealTimers()
  })

  it('ignores empty notebook IDs', () => {
    enqueueLocalNotebookIndexSync('', { changedRelativePath: 'a.md' })
    enqueueLocalNotebookIndexSync('  ', { changedRelativePath: 'a.md' })
    expect(hasPendingIndexSync()).toBe(false)
  })

  it('does not merge trim-only notebook id aliases into the same queue key', async () => {
    vi.useFakeTimers()
    const baseMount = createMount({
      notebook: {
        id: 'nb-1',
        name: 'Base',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 0,
        created_at: '2026-01-01',
      } as any,
      mount: {
        root_path: '/tmp/base',
        canonical_root_path: '/tmp/base',
        status: 'active',
      } as any,
    })
    const spacedMount = createMount({
      notebook: {
        id: '  nb-1  ',
        name: 'Spaced',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01',
      } as any,
      mount: {
        root_path: '/tmp/spaced',
        canonical_root_path: '/tmp/spaced',
        status: 'active',
      } as any,
    })
    vi.mocked(getLocalFolderMounts).mockReturnValue([baseMount, spacedMount])
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000, size: 100 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'base.md', immediate: true })
    enqueueLocalNotebookIndexSync('  nb-1  ', { changedRelativePath: 'spaced.md', immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(baseMount, 'base.md')
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(spacedMount, 'spaced.md')
    vi.useRealTimers()
  })

  it('re-schedules after current sync completes if new requests queued', async () => {
    vi.useFakeTimers()

    let callCount = 0
    vi.mocked(readLocalFolderFileAsync).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // Queue a second request while first sync is still processing
        enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'second.md', immediate: true })
      }
      return { success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any
    })
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'first.md', immediate: true })
    await vi.runAllTimersAsync()

    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'first.md')
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'second.md')
    vi.useRealTimers()
  })
})

// --- Cancellation ---

describe('cancellation', () => {
  it('cancelPendingLocalNotebookIndexSync clears timers and requests', () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({ success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    expect(hasPendingIndexSync()).toBe(true)

    cancelPendingLocalNotebookIndexSync()
    expect(hasPendingIndexSync()).toBe(false)
    vi.useRealTimers()
  })

  it('cancelPendingLocalNotebookIndexSync with invalidateRunning aborts running sync', async () => {
    vi.useFakeTimers()
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])

    const tree = createTree([{ relative_path: 'a.md' }, { relative_path: 'b.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())

    let readCallCount = 0
    vi.mocked(readLocalFolderFileAsync).mockImplementation(() => {
      readCallCount++
      if (readCallCount === 1) {
        // Cancel during first file read
        cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
      }
      return { success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any
    })

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    // Cancel happened during first file read, so only a.md was read (b.md never reached)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'a.md')
    // Partial index for a.md should be cleaned up after cancellation
    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'a.md', { noteUid: 'uid:a.md' })
    vi.useRealTimers()
  })

  it('clearLocalNotebookIndexSyncForNotebook aborts running sync for target notebook', async () => {
    vi.useFakeTimers()
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])

    const tree = createTree([{ relative_path: 'a.md' }, { relative_path: 'b.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())

    let readCallCount = 0
    vi.mocked(readLocalFolderFileAsync).mockImplementation(() => {
      readCallCount += 1
      if (readCallCount === 1) {
        clearLocalNotebookIndexSyncForNotebook('nb-1')
        expect(hasPendingIndexSync()).toBe(true)
      }
      return { success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any
    })

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'a.md')
    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'a.md', { noteUid: 'uid:a.md' })
    vi.useRealTimers()
  })

  it('clear + immediate re-enqueue does not revive the old running sync', async () => {
    vi.useFakeTimers()
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])

    const tree = createTree([{ relative_path: 'a.md' }, { relative_path: 'b.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())

    let didTriggerClear = false
    vi.mocked(readLocalFolderFileAsync).mockImplementation((_mount, relativePath) => {
      if (relativePath === 'a.md' && !didTriggerClear) {
        didTriggerClear = true
        clearLocalNotebookIndexSyncForNotebook('nb-1')
        enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'requeued.md', immediate: true })
      }
      return { success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any
    })

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(readLocalFolderFileAsync).not.toHaveBeenCalledWith(mount, 'b.md')
    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'a.md', { noteUid: 'uid:a.md' })
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'requeued.md')
    vi.useRealTimers()
  })

  it('clear does not requeue old incremental tail when run-cap branch is reached', async () => {
    vi.useFakeTimers()
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    const changedPaths = Array.from({ length: 300 }, (_value, index) => `cap-${index}.md`)
    let readCallCount = 0
    vi.mocked(readLocalFolderFileAsync).mockImplementation((_mount, _relativePath) => {
      readCallCount += 1
      if (readCallCount === 256) {
        clearLocalNotebookIndexSyncForNotebook('nb-1')
      }
      return { success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any
    })

    enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: changedPaths,
      immediate: true,
    })
    await vi.runAllTimersAsync()

    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(256)
    expect(hasPendingIndexSync()).toBe(false)
    vi.useRealTimers()
  })

  it('clear does not requeue old full-sync tail when run-cap branch is reached', async () => {
    vi.useFakeTimers()
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])

    const tree = createTree(Array.from({ length: 300 }, (_value, index) => ({ relative_path: `full-cap-${index}.md` })))
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())

    let readCallCount = 0
    vi.mocked(readLocalFolderFileAsync).mockImplementation((_mount, _relativePath) => {
      readCallCount += 1
      if (readCallCount === 256) {
        clearLocalNotebookIndexSyncForNotebook('nb-1')
      }
      return { success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any
    })

    enqueueLocalNotebookIndexSync('nb-1', {
      full: true,
      immediate: true,
    })
    await vi.runAllTimersAsync()

    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(256)
    expect(hasPendingIndexSync()).toBe(false)
    vi.useRealTimers()
  })
})

// --- Other exports ---

describe('hasPendingIndexSync', () => {
  it('returns false when nothing is queued', () => {
    expect(hasPendingIndexSync()).toBe(false)
  })

  it('returns true when timer exists', () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])
    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    expect(hasPendingIndexSync()).toBe(true)
    cancelPendingLocalNotebookIndexSync()
    vi.useRealTimers()
  })
})

describe('resetLocalNotebookIndexSyncState', () => {
  it('clears queued requests and timers', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    expect(hasPendingIndexSync()).toBe(true)

    resetLocalNotebookIndexSyncState()
    expect(hasPendingIndexSync()).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('clearLocalNotebookIndexSyncForNotebook', () => {
  it('clears specific notebook state', () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])
    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    enqueueLocalNotebookIndexSync('nb-2', { changedRelativePath: 'b.md' })
    expect(hasPendingIndexSync()).toBe(true)

    clearLocalNotebookIndexSyncForNotebook('nb-1')
    // nb-2 should still be pending
    expect(hasPendingIndexSync()).toBe(true)

    clearLocalNotebookIndexSyncForNotebook('nb-2')
    expect(hasPendingIndexSync()).toBe(false)
    vi.useRealTimers()
  })
})

describe('rebuildLocalNotebookIndexesAfterInternalRebuild', () => {
  it('iterates all mounts with full sync', async () => {
    const mount1 = createMount({ notebook: { id: 'nb-1', name: 'A', icon: '', source_type: 'local-folder', order_index: 0, created_at: '' } })
    const mount2 = createMount({ notebook: { id: 'nb-2', name: 'B', icon: '', source_type: 'local-folder', order_index: 1, created_at: '' } })
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount1, mount2])

    const tree1 = createTree([{ relative_path: 'x.md' }])
    const tree2 = createTree([{ relative_path: 'y.md' }])
    vi.mocked(scanLocalFolderMountForSearchAsync)
      .mockResolvedValueOnce(tree1)
      .mockResolvedValueOnce(tree2)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    await rebuildLocalNotebookIndexesAfterInternalRebuild()

    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(2)
    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledWith(mount1, { sortEntries: false })
    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledWith(mount2, { sortEntries: false })
  })

  it('reports pending while internal rebuild-triggered local sync is running', async () => {
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(
      createTree([{ relative_path: 'x.md' }])
    )
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())

    let resolveReadStarted: () => void = () => {}
    const readStarted = new Promise<void>((resolve) => {
      resolveReadStarted = resolve
    })
    let resolveRead: () => void = () => {}
    vi.mocked(readLocalFolderFileAsync).mockImplementation(() => (
      new Promise((resolve) => {
        resolveReadStarted()
        resolveRead = () => {
          resolve({
            success: true,
            result: { tiptap_content: '{}', mtime_ms: 1000 },
          } as any)
        }
      })
    ) as any)

    const rebuildTask = rebuildLocalNotebookIndexesAfterInternalRebuild()
    await readStarted
    expect(hasPendingIndexSync()).toBe(true)
    expect(hasPendingFullIndexSyncForNotebook('nb-1')).toBe(true)

    resolveRead()
    await rebuildTask
    expect(hasPendingIndexSync()).toBe(false)
    expect(hasPendingFullIndexSyncForNotebook('nb-1')).toBe(false)
  })

  it('clearLocalNotebookIndexSyncForNotebook aborts running rebuild-triggered sync', async () => {
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(
      createTree([{ relative_path: 'a.md' }, { relative_path: 'b.md' }])
    )
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())

    let readCallCount = 0
    vi.mocked(readLocalFolderFileAsync).mockImplementation((_mount, _relativePath) => {
      readCallCount += 1
      if (readCallCount === 1) {
        clearLocalNotebookIndexSyncForNotebook('nb-1')
      }
      return {
        success: true,
        result: { tiptap_content: '{}', mtime_ms: 1000 },
      } as any
    })

    await rebuildLocalNotebookIndexesAfterInternalRebuild()

    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'a.md')
    expect(deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'a.md', { noteUid: 'uid:a.md' })
  })
})

describe('flushQueuedLocalNotebookIndexSync', () => {
  beforeEach(() => {
    vi.mocked(isKnowledgeBaseRebuilding).mockReturnValue(false)
  })

  it('schedules immediate sync for all queued notebooks', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    // Queue with default debounce (900ms)
    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })

    // Flush should schedule immediate
    flushQueuedLocalNotebookIndexSync()
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFileAsync).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does nothing when knowledge base is rebuilding', () => {
    vi.useFakeTimers()
    vi.mocked(isKnowledgeBaseRebuilding).mockReturnValue(true)
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    vi.mocked(isKnowledgeBaseRebuilding).mockReturnValue(true)
    flushQueuedLocalNotebookIndexSync()

    // Should not have triggered any sync
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
