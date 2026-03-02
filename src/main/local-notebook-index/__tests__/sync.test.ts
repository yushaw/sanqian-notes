import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LocalFolderNotebookMount, LocalFolderTreeResult } from '../../../shared/types'

// --- Mocks ---

vi.mock('../../database', () => ({
  getLocalFolderMounts: vi.fn(),
  getLocalNoteIdentityByPath: vi.fn(),
  ensureLocalNoteIdentity: vi.fn(),
}))
vi.mock('../../local-folder', () => ({
  readLocalFolderFile: vi.fn(),
}))
vi.mock('../../local-note-state-cleanup', () => ({
  cleanupMissingLocalNoteState: vi.fn(),
}))
vi.mock('../../embedding', () => ({
  indexingService: {
    checkAndIndex: vi.fn().mockResolvedValue(true),
    deleteNoteIndex: vi.fn(),
  },
}))
vi.mock('../../local-folder-tree-cache', () => ({
  scanAndCacheLocalFolderTree: vi.fn(),
}))
vi.mock('../helpers', () => ({
  normalizeLocalIndexSyncPath: vi.fn(),
  resolveLocalIndexNoteId: vi.fn(),
  deleteLegacyLocalIndexByPath: vi.fn(),
  collectIndexedLocalNoteIdsByNotebook: vi.fn(),
  deleteIndexedLocalNotesByNotebook: vi.fn(),
  deleteIndexForLocalPath: vi.fn(),
  syncLocalNoteTagsMetadata: vi.fn(),
  syncLocalNotePopupRefs: vi.fn(),
  deleteLocalNoteMetadataByPath: vi.fn(),
  deleteLocalNoteIdentityByPath: vi.fn(),
}))
vi.mock('../knowledge-base-rebuild', () => ({
  isKnowledgeBaseRebuilding: vi.fn().mockReturnValue(false),
}))

import { getLocalFolderMounts, getLocalNoteIdentityByPath, ensureLocalNoteIdentity } from '../../database'
import { readLocalFolderFile } from '../../local-folder'
import { cleanupMissingLocalNoteState } from '../../local-note-state-cleanup'
import { indexingService } from '../../embedding'
import { scanAndCacheLocalFolderTree } from '../../local-folder-tree-cache'
import {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  deleteLegacyLocalIndexByPath,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNotePopupRefs,
  deleteLocalNoteMetadataByPath,
  deleteLocalNoteIdentityByPath,
} from '../helpers'
import { isKnowledgeBaseRebuilding } from '../knowledge-base-rebuild'

import {
  enqueueLocalNotebookIndexSync,
  cancelPendingLocalNotebookIndexSync,
  hasPendingIndexSync,
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
    expect(readLocalFolderFile).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reads files and syncs tags + popup refs (no FTS/checkAndIndex)', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"content":"test"}', mtime_ms: 1000, size: 50 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'foo.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFile).toHaveBeenCalledWith(mount, 'foo.md')
    expect(ensureLocalNoteIdentity).toHaveBeenCalledWith({ notebook_id: 'nb-1', relative_path: 'foo.md' })
    expect(syncLocalNoteTagsMetadata).toHaveBeenCalledWith('nb-1', 'foo.md', '{"content":"test"}')
    expect(syncLocalNotePopupRefs).toHaveBeenCalledWith('nb-1', 'foo.md', '{"content":"test"}')
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('handles file read failure and deletes index + metadata for specific error codes', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue({ note_uid: 'uid-old' } as any)
    vi.mocked(readLocalFolderFile).mockReturnValue({
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
    vi.mocked(readLocalFolderFile).mockReturnValue({
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

  it('scans tree, ensures identities, resolves local IDs, and indexes files', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }, { relative_path: 'b.md' }])
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(scanAndCacheLocalFolderTree).toHaveBeenCalledWith(mount)
    expect(ensureLocalNoteIdentity).toHaveBeenCalledWith({ notebook_id: 'nb-1', relative_path: 'a.md' })
    expect(ensureLocalNoteIdentity).toHaveBeenCalledWith({ notebook_id: 'nb-1', relative_path: 'b.md' })
    expect(cleanupMissingLocalNoteState).toHaveBeenCalledWith(
      'nb-1',
      new Set(['a.md', 'b.md']),
      normalizeLocalIndexSyncPath
    )
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('deletes stale indexed IDs not in current tree', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set(['uid:a.md', 'stale-id']))
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('stale-id')
    vi.useRealTimers()
  })

  it('calls deleteLegacyLocalIndexByPath before checkAndIndex', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    const callOrder: string[] = []
    vi.mocked(deleteLegacyLocalIndexByPath).mockImplementation(() => { callOrder.push('deleteLegacy') })
    vi.mocked(indexingService.checkAndIndex).mockImplementation(async () => { callOrder.push('checkAndIndex'); return true })

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(callOrder).toEqual(['deleteLegacy', 'checkAndIndex'])
    vi.useRealTimers()
  })

  it('indexes with ftsOnly: true and fileMtimeMs', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 2000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(indexingService.checkAndIndex).toHaveBeenCalledWith(
      'uid:a.md',
      'nb-1',
      '{"doc":true}',
      { ftsOnly: true, fileMtimeMs: 2000 }
    )
    vi.useRealTimers()
  })

  it('deletes index when file read fails during full sync', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'bad.md' }])
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFile).mockReturnValue({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uid:bad.md')
    expect(deleteLegacyLocalIndexByPath).toHaveBeenCalledWith('nb-1', 'bad.md')
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('handles tree scan failure with early return', async () => {
    vi.useFakeTimers()
    vi.mocked(scanAndCacheLocalFolderTree).mockImplementation(() => { throw new Error('scan failed') })
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
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"text":"hello"}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(syncLocalNoteTagsMetadata).toHaveBeenCalledWith('nb-1', 'note.md', '{"text":"hello"}')
    expect(syncLocalNotePopupRefs).toHaveBeenCalledWith('nb-1', 'note.md', '{"text":"hello"}')
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
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'b.md' })
    await vi.advanceTimersByTimeAsync(1000)

    expect(readLocalFolderFile).toHaveBeenCalledWith(mount, 'a.md')
    expect(readLocalFolderFile).toHaveBeenCalledWith(mount, 'b.md')
    vi.useRealTimers()
  })

  it('full: true upgrades existing request', async () => {
    vi.useFakeTimers()
    const tree = createTree([{ relative_path: 'a.md' }])
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })
    enqueueLocalNotebookIndexSync('nb-1', { full: true })
    await vi.advanceTimersByTimeAsync(1000)

    // Full sync path: scanAndCacheLocalFolderTree is called
    expect(scanAndCacheLocalFolderTree).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('debounces with 900ms default delay', async () => {
    vi.useFakeTimers()
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })

    // Not yet fired at 800ms
    await vi.advanceTimersByTimeAsync(800)
    expect(readLocalFolderFile).not.toHaveBeenCalled()

    // Fires at 900ms
    await vi.advanceTimersByTimeAsync(200)
    expect(readLocalFolderFile).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('fires immediately when immediate: true', async () => {
    vi.useFakeTimers()
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md', immediate: true })
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFile).toHaveBeenCalled()
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

  it('re-schedules after current sync completes if new requests queued', async () => {
    vi.useFakeTimers()

    let callCount = 0
    vi.mocked(readLocalFolderFile).mockImplementation(() => {
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

    expect(readLocalFolderFile).toHaveBeenCalledWith(mount, 'first.md')
    expect(readLocalFolderFile).toHaveBeenCalledWith(mount, 'second.md')
    vi.useRealTimers()
  })
})

// --- Cancellation ---

describe('cancellation', () => {
  it('cancelPendingLocalNotebookIndexSync clears timers and requests', () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])
    vi.mocked(readLocalFolderFile).mockReturnValue({ success: true, result: { tiptap_content: '{}', mtime_ms: 1000 } } as any)

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
    vi.mocked(scanAndCacheLocalFolderTree).mockReturnValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())

    let readCallCount = 0
    vi.mocked(readLocalFolderFile).mockImplementation(() => {
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
    expect(readLocalFolderFile).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFile).toHaveBeenCalledWith(mount, 'a.md')
    // Partial index for a.md should be cleaned up after cancellation
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledWith('uid:a.md')
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
    vi.mocked(scanAndCacheLocalFolderTree)
      .mockReturnValueOnce(tree1)
      .mockReturnValueOnce(tree2)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)

    await rebuildLocalNotebookIndexesAfterInternalRebuild()

    expect(scanAndCacheLocalFolderTree).toHaveBeenCalledTimes(2)
    expect(scanAndCacheLocalFolderTree).toHaveBeenCalledWith(mount1)
    expect(scanAndCacheLocalFolderTree).toHaveBeenCalledWith(mount2)
  })
})

describe('flushQueuedLocalNotebookIndexSync', () => {
  beforeEach(() => {
    vi.mocked(isKnowledgeBaseRebuilding).mockReturnValue(false)
  })

  it('schedules immediate sync for all queued notebooks', async () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([createMount()])
    vi.mocked(readLocalFolderFile).mockReturnValue({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    } as any)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    // Queue with default debounce (900ms)
    enqueueLocalNotebookIndexSync('nb-1', { changedRelativePath: 'a.md' })

    // Flush should schedule immediate
    flushQueuedLocalNotebookIndexSync()
    await vi.advanceTimersByTimeAsync(10)

    expect(readLocalFolderFile).toHaveBeenCalled()
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
    expect(readLocalFolderFile).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
