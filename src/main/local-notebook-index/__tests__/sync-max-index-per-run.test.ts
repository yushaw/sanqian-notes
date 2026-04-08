import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalFolderNotebookMount, LocalFolderTreeResult } from '../../../shared/types'

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
  getNoteIndexStatusBatch: vi.fn().mockReturnValue(new Map()),
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
vi.mock('../../local-performance-audit', () => ({
  emitLocalPerformanceSummaryAudit: vi.fn(),
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
import { getCachedLocalFolderTree, invalidateLocalFolderTreeCache } from '../../local-folder-tree-cache'
import { indexingService, getNoteIndexStatusBatch, updateNoteIndexFileMtimeIfIndexed } from '../../embedding'
import { emitLocalPerformanceSummaryAudit } from '../../local-performance-audit'
import {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  collectIndexedLocalNoteIdsByNotebook,
  syncLocalNoteTagsMetadata,
  syncLocalNoteTagsMetadataBatch,
  syncLocalNotePopupRefs,
  syncLocalNotePopupRefsBatch,
} from '../helpers'

function createMount(options?: { rootPath?: string; canonicalRootPath?: string }): LocalFolderNotebookMount {
  const rootPath = options?.rootPath || '/tmp/test'
  const canonicalRootPath = options?.canonicalRootPath || rootPath
  return {
    notebook: {
      id: 'nb-1',
      name: 'Test',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: '2026-01-01',
    },
    mount: {
      root_path: rootPath,
      canonical_root_path: canonicalRootPath,
      status: 'active',
    },
  } as LocalFolderNotebookMount
}

function createTree(files: { relative_path: string }[]): LocalFolderTreeResult {
  return {
    notebook_id: 'nb-1',
    files: files.map((f) => ({ relative_path: f.relative_path, mtime_ms: 1000, size: 100 })),
    folders: [],
  } as unknown as LocalFolderTreeResult
}

interface EnsuredIdentity {
  note_uid: string
  notebook_id: string
  relative_path: string
  created_at: string
  updated_at: string
}

describe('local index sync max-index-per-run', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
    vi.mocked(getCachedLocalFolderTree).mockReturnValue(null)
    vi.mocked(invalidateLocalFolderTreeCache).mockImplementation(() => undefined)
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('processes remaining files via incremental requeue when full-sync cap is reached', async () => {
    const mount = createMount()
    const tree = createTree([
      { relative_path: 'a.md' },
      { relative_path: 'b.md' },
      { relative_path: 'c.md' },
    ])

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(3)
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(3)
  })
})

describe('local index sync immediate delay policy', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '120'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('defers immediate cold full-sync by configured initial delay', async () => {
    const mount = createMount()
    const tree = createTree([{ relative_path: 'a.md' }])

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(100)

    expect(scanLocalFolderMountForSearchAsync).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30)
    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
  })

  it('full request supersedes queued incremental force-index request for delay policy', async () => {
    const mount = createMount()
    const tree = createTree([{ relative_path: 'a.md' }])

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePath: 'stale.md',
      forceIndexForPaths: true,
      immediate: true,
    })
    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })

    await vi.advanceTimersByTimeAsync(100)
    expect(scanLocalFolderMountForSearchAsync).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30)
    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
  })
})

describe('local index sync startup delay adaptive scheduling', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_DELAY_ADAPTIVE_ENABLED = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_INITIAL_FULL_DELAY_MS = '180'
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '60000'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
    vi.mocked(getCachedLocalFolderTree).mockReturnValue(null)
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_DELAY_ADAPTIVE_ENABLED
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_PERF_STARTUP_WINDOW_MS
    vi.useRealTimers()
  })

  it('applies startup-specific initial delay for immediate cold full-sync', async () => {
    const mount = createMount()
    const tree = createTree([{ relative_path: 'a.md' }])

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(120)
    expect(scanLocalFolderMountForSearchAsync).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(80)
    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
  })
})

describe('local index sync startup adaptive cap', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN = '1'
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '60000'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_PERF_STARTUP_WINDOW_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('applies stricter startup cap even when base cap is unlimited', async () => {
    const mount = createMount()
    const tree = createTree([
      { relative_path: 'a.md' },
      { relative_path: 'b.md' },
      { relative_path: 'c.md' },
    ])

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(3)
  })
})

describe('local index sync cold-full adaptive cap', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED = '0'
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED
    delete process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    delete process.env.LOCAL_PERF_STARTUP_WINDOW_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('caps cold full sync runs even when base cap is unlimited', async () => {
    const mount = createMount()
    const tree = createTree([
      { relative_path: 'a.md' },
      { relative_path: 'b.md' },
      { relative_path: 'c.md' },
    ])

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(3)
  })
})

describe('local index sync force-index incremental cap', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '100'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('requeues remaining force-index incremental paths when cap is reached', async () => {
    const mount = createMount()

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(createTree([]))
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'a.md', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: ['a.md', 'b.md', 'c.md'],
      forceIndexForPaths: true,
      immediate: true,
    })

    await vi.advanceTimersByTimeAsync(20)

    expect(scanLocalFolderMountForSearchAsync).not.toHaveBeenCalled()
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(0)
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(0)

    await vi.advanceTimersByTimeAsync(120)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(120)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(120)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(3)
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(3)
    expect(ensureLocalNoteIdentitiesBatch).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(ensureLocalNoteIdentitiesBatch).mock.calls.map((call) => Array.from(call[0]?.relative_paths || []))
    ).toEqual([
      ['a.md'],
      ['b.md'],
      ['c.md'],
    ])
    expect(getNoteIndexStatusBatch).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(getNoteIndexStatusBatch).mock.calls.map((call) => Array.from(call[0] || []))
    ).toEqual([
      ['uid:a.md'],
      ['uid:b.md'],
      ['uid:c.md'],
    ])
  })

})

describe('local index sync force-index incremental batching', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '100'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('uses batch metadata/popup sync for multi-path force-index incremental runs', async () => {
    const mount = createMount()

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(createTree([]))
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: ['a.md', 'b.md'],
      forceIndexForPaths: true,
      immediate: true,
    })

    await vi.advanceTimersByTimeAsync(220)

    expect(syncLocalNoteTagsMetadata).not.toHaveBeenCalled()
    expect(syncLocalNotePopupRefs).not.toHaveBeenCalled()
    expect(syncLocalNoteTagsMetadataBatch).toHaveBeenCalledTimes(1)
    expect(syncLocalNotePopupRefsBatch).toHaveBeenCalledTimes(1)
    expect(getNoteIndexStatusBatch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getNoteIndexStatusBatch).mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(['uid:a.md', 'uid:b.md'])
    )
  })

  it('skips force-index checkAndIndex when preloaded status mtime matches file mtime', async () => {
    const mount = createMount()

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(createTree([]))
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map([
      ['uid:a.md', {
        noteId: 'uid:a.md',
        contentHash: 'h1',
        chunkCount: 1,
        modelName: '',
        indexedAt: '2026-01-01T00:00:00.000Z',
        status: 'indexed',
        ftsStatus: 'indexed',
        embeddingStatus: 'none',
        fileMtime: new Date(1000).toISOString(),
      }],
      ['uid:b.md', {
        noteId: 'uid:b.md',
        contentHash: 'h1',
        chunkCount: 1,
        modelName: '',
        indexedAt: '2026-01-01T00:00:00.000Z',
        status: 'indexed',
        ftsStatus: 'indexed',
        embeddingStatus: 'none',
        fileMtime: new Date(1000).toISOString(),
      }],
    ]))

    syncApi.enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: ['a.md', 'b.md'],
      forceIndexForPaths: true,
      immediate: true,
    })

    await vi.advanceTimersByTimeAsync(220)

    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    expect(syncLocalNoteTagsMetadataBatch).not.toHaveBeenCalled()
    expect(syncLocalNotePopupRefsBatch).not.toHaveBeenCalled()
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
  })

  it('backfills missing mtime and skips force-index file read when indexedAt is newer than known mtime', async () => {
    const mount = createMount()
    const knownMtimeMs = Date.parse('2026-02-01T00:00:00.000Z')

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(createTree([]))
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)
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
      }],
    ]))
    vi.mocked(updateNoteIndexFileMtimeIfIndexed).mockReturnValue(true)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: ['a.md'],
      knownFileMtimeMsByPath: [['a.md', knownMtimeMs]],
      forceIndexForPaths: true,
      immediate: true,
    })

    await vi.advanceTimersByTimeAsync(220)

    expect(updateNoteIndexFileMtimeIfIndexed).toHaveBeenCalledWith(
      'uid:a.md',
      '2026-02-01T00:00:00.000Z'
    )
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    expect(syncLocalNoteTagsMetadataBatch).not.toHaveBeenCalled()
    expect(syncLocalNotePopupRefsBatch).not.toHaveBeenCalled()
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()
  })
})

describe('local index sync run-time budget', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS = '30'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '100'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('requeues remaining force-index incremental paths when run-time budget is exceeded', async () => {
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(createTree([]))
    vi.mocked(getLocalNoteIdentityByPath).mockReturnValue(null)

    let nowMs = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    vi.mocked(readLocalFolderFileAsync).mockImplementation(async () => {
      nowMs += 40
      return {
        success: true,
        result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
      } as never
    })

    try {
      syncApi.enqueueLocalNotebookIndexSync('nb-1', {
        changedRelativePaths: ['a.md', 'b.md', 'c.md'],
        forceIndexForPaths: true,
        immediate: true,
      })

      await vi.advanceTimersByTimeAsync(600)
      expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(3)
      expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(3)
      const auditPayloads = vi.mocked(emitLocalPerformanceSummaryAudit).mock.calls
        .map((call) => call[2] as Record<string, unknown> | undefined)
        .filter(Boolean) as Array<Record<string, unknown>>
      expect(auditPayloads.length).toBeGreaterThan(1)
      expect(auditPayloads.some((payload) => Number(payload.requeued_path_count || 0) > 0)).toBe(true)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('local index sync stale-delete pacing', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN = '1'
    process.env.LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE = '16'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '50'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(getCachedLocalFolderTree).mockReturnValue(null)
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    vi.useRealTimers()
  })

  it('caps stale index deletion per run and defers full indexing until stale cleanup converges', async () => {
    const mount = createMount()
    const tree = createTree([{ relative_path: 'a.md' }])
    const indexedIds = new Set<string>(['stale-1', 'stale-2', 'uid:a.md'])

    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(scanLocalFolderMountForSearchAsync).mockResolvedValue(tree)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockImplementation(() => new Set(indexedIds))
    vi.mocked(indexingService.deleteNoteIndex).mockImplementation((noteId: string) => {
      indexedIds.delete(noteId)
    })
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })

    await vi.advanceTimersByTimeAsync(60)
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).not.toHaveBeenCalled()
    expect(indexingService.checkAndIndex).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60)
    expect(indexingService.deleteNoteIndex).toHaveBeenCalledTimes(2)
    expect(readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(indexingService.checkAndIndex).toHaveBeenCalledTimes(1)
    expect(indexedIds.has('uid:a.md')).toBe(true)
  })
})

describe('local index sync cooperative preload chunking', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE = '16'
    process.env.LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE = '16'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
    vi.mocked(getCachedLocalFolderTree).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE
    vi.useRealTimers()
  })

  it('chunks incremental identity and status preload work into cooperative batches', async () => {
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])

    const paths = Array.from({ length: 40 }, (_, idx) => `doc-${idx + 1}.md`)
    syncApi.enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: paths,
      forceIndexForPaths: true,
      immediate: true,
    })

    await vi.advanceTimersByTimeAsync(1200)

    expect(ensureLocalNoteIdentitiesBatch).toHaveBeenCalledTimes(3)
    expect(vi.mocked(ensureLocalNoteIdentitiesBatch).mock.calls.map((call) => (
      Array.from(call[0]?.relative_paths || []).length
    ))).toEqual([16, 16, 8])

    expect(getNoteIndexStatusBatch).toHaveBeenCalledTimes(3)
    expect(vi.mocked(getNoteIndexStatusBatch).mock.calls.map((call) => (
      Array.from(call[0] || []).length
    ))).toEqual([16, 16, 8])
  })
})

describe('local index sync startup adaptive preload chunking', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE = '16'
    process.env.LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE = '16'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_IDENTITY_BATCH_SIZE = '8'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_STATUS_PRELOAD_BATCH_SIZE = '9'
    process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED = '1'
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '60000'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
    vi.mocked(getCachedLocalFolderTree).mockReturnValue(null)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_IDENTITY_BATCH_SIZE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_STATUS_PRELOAD_BATCH_SIZE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    delete process.env.LOCAL_PERF_STARTUP_WINDOW_MS
    vi.useRealTimers()
  })

  it('uses startup-specific smaller preload chunks during startup window', async () => {
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])

    const paths = Array.from({ length: 12 }, (_, idx) => `startup-doc-${idx + 1}.md`)
    syncApi.enqueueLocalNotebookIndexSync('nb-1', {
      changedRelativePaths: paths,
      forceIndexForPaths: true,
      immediate: true,
    })

    await vi.advanceTimersByTimeAsync(1200)

    expect(ensureLocalNoteIdentitiesBatch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(ensureLocalNoteIdentitiesBatch).mock.calls.map((call) => (
      Array.from(call[0]?.relative_paths || []).length
    ))).toEqual([8, 4])

    expect(getNoteIndexStatusBatch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(getNoteIndexStatusBatch).mock.calls.map((call) => (
      Array.from(call[0] || []).length
    ))).toEqual([9, 3])
  })
})

describe('local index sync scan cache reuse', () => {
  let syncApi: typeof import('../sync')

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = '999999'
    process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = '0'
    process.env.LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS = '1500'

    vi.resetModules()
    syncApi = await import('../sync')
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()

    vi.mocked(normalizeLocalIndexSyncPath).mockImplementation((p) => p || null)
    vi.mocked(resolveLocalIndexNoteId).mockImplementation((_nb, p) => `uid:${p}`)
    vi.mocked(collectIndexedLocalNoteIdsByNotebook).mockReturnValue(new Set())
    vi.mocked(getNoteIndexStatusBatch).mockReturnValue(new Map())
    vi.mocked(getCachedLocalFolderTree).mockReturnValue(null)
    vi.mocked(statLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { relative_path: 'default.md', mtime_ms: 1000, size: 100 },
    } as never)
    vi.mocked(ensureLocalNoteIdentity).mockImplementation(({ relative_path }) => (
      relative_path ? ({ note_uid: `uid:${relative_path}` } as never) : null
    ))
    vi.mocked(listLocalNoteIdentity).mockReturnValue([])
    vi.mocked(ensureLocalNoteIdentitiesBatch).mockImplementation(({ relative_paths }) => {
      const ensured = new Map<string, EnsuredIdentity>()
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
  })

  afterEach(() => {
    syncApi.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    syncApi.resetLocalNotebookIndexSyncState()
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
    delete process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
    delete process.env.LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS
    vi.useRealTimers()
  })

  it('reuses local-folder tree cache to avoid redundant full-scan', async () => {
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(getCachedLocalFolderTree).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/tmp/test',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [{ relative_path: 'cached.md', mtime_ms: 1000, size: 100 }],
    } as never)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(getCachedLocalFolderTree).toHaveBeenCalledWith('nb-1', 1500)
    expect(scanLocalFolderMountForSearchAsync).not.toHaveBeenCalled()
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'cached.md')
  })

  it('reuses local-folder tree cache when cached root normalizes to mount canonical root', async () => {
    const mount = createMount({
      rootPath: '/tmp/project/notes',
      canonicalRootPath: '/tmp/project/notes',
    })
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(getCachedLocalFolderTree).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/tmp/project/notes/../notes',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [{ relative_path: 'cached.md', mtime_ms: 1000, size: 100 }],
    } as never)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(scanLocalFolderMountForSearchAsync).not.toHaveBeenCalled()
    expect(invalidateLocalFolderTreeCache).not.toHaveBeenCalled()
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'cached.md')
  })

  it('invalidates stale scan cache when cached root mismatches mount root before full scan', async () => {
    const mount = createMount()
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(getCachedLocalFolderTree).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/tmp/old-root',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    } as never)
    vi.mocked(scanLocalFolderMountForSearchAsync).mockReturnValue(createTree([{ relative_path: 'scanned.md' }]) as never)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'scanned.md')
  })

  it('keeps full scan running when stale cache invalidation throws', async () => {
    const mount = createMount()
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(getLocalFolderMounts).mockReturnValue([mount])
    vi.mocked(getCachedLocalFolderTree).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/tmp/old-root',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    } as never)
    vi.mocked(invalidateLocalFolderTreeCache).mockImplementation(() => {
      throw new Error('cache unavailable')
    })
    vi.mocked(scanLocalFolderMountForSearchAsync).mockReturnValue(createTree([{ relative_path: 'scanned.md' }]) as never)
    vi.mocked(readLocalFolderFileAsync).mockReturnValue({
      success: true,
      result: { tiptap_content: '{"doc":true}', mtime_ms: 1000, size: 100 },
    } as never)

    syncApi.enqueueLocalNotebookIndexSync('nb-1', { full: true, immediate: true })
    await vi.advanceTimersByTimeAsync(20)

    expect(scanLocalFolderMountForSearchAsync).toHaveBeenCalledTimes(1)
    expect(readLocalFolderFileAsync).toHaveBeenCalledWith(mount, 'scanned.md')
    expect(consoleWarnSpy).toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })
})
