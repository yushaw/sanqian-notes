import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalFolderNotebookMount, LocalFolderTreeResult } from '../../shared/types'
import type { LocalFolderIpcDeps } from '../ipc/register-local-folder-ipc'

type Handler = (...args: unknown[]) => unknown
const ORIGINAL_NODE_ENV = process.env.NODE_ENV

function createMount(rootPath: string = '/tmp/test-folder'): LocalFolderNotebookMount {
  const now = new Date().toISOString()
  return {
    notebook: {
      id: 'nb-1',
      name: 'Test Folder',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: 'nb-1',
      root_path: rootPath,
      canonical_root_path: rootPath,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  }
}

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

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  delete process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED
  delete process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY
  delete process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED
  delete process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS
  delete process.env.LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS
  delete process.env.LOCAL_PERF_STARTUP_WINDOW_MS
  vi.useRealTimers()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('localFolder:getTree fast load preview warmup', () => {
  it('uses fast tree load outside startup window by default', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    process.env.NODE_ENV = 'development'
    process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED = '1'
    delete process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY
    process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED = '0'
    process.env.LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS = '0'
    process.env.LOCAL_PERF_STARTUP_WINDOW_MS = '1'

    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    const mount = createMount()
    const fastTree: LocalFolderTreeResult = {
      notebook_id: mount.notebook.id,
      root_path: mount.mount.root_path,
      scanned_at: new Date().toISOString(),
      tree: [],
      files: [],
    }
    const scanAndCacheLocalFolderTreeAsync = vi.fn(async () => fastTree)

    const deps = {
      getLocalFolderMounts: vi.fn(() => [mount]),
      getLocalFolderMountByNotebookId: vi.fn(() => ({
        root_path: mount.mount.root_path,
        status: 'active',
      })),
      scanAndCacheLocalFolderTreeAsync,
      scheduleLocalFolderWatchEvent: vi.fn(),
      ensureLocalFolderWatcher: vi.fn(),
      updateLocalFolderMountStatus: vi.fn(() => 'updated'),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      stopLocalFolderWatcher: vi.fn(),
      resolveMountStatusFromFsError: vi.fn(() => 'missing'),
      getLocalFolderMountByCanonicalPath: vi.fn(() => null),
      createLocalFolderNotebookMountSafe: vi.fn(),
      updateLocalFolderMountRoot: vi.fn(),
      readLocalFolderFileAsync: vi.fn(),
      saveLocalFolderFileAsync: vi.fn(),
      createLocalFolderFileAsync: vi.fn(),
      createLocalFolderAsync: vi.fn(),
      renameLocalFolderEntryAsync: vi.fn(),
      resolveLocalFolderDeleteTargetAsync: vi.fn(),
      resolveLocalFolderFilePathAsync: vi.fn(),
      readLocalFolderFile: vi.fn(),
      ensureLocalNoteIdentity: vi.fn(),
      renameLocalNoteIdentityPath: vi.fn(),
      renameLocalNoteIdentityFolderPath: vi.fn(),
      deleteLocalNoteIdentityByPath: vi.fn(),
      getLocalNoteIdentityByPath: vi.fn(() => null),
      listLocalNoteMetadata: vi.fn(() => []),
      updateLocalNoteMetadata: vi.fn(),
      renameLocalNoteMetadataPath: vi.fn(),
      renameLocalNoteMetadataFolderPath: vi.fn(),
      deleteLocalNoteMetadataByPath: vi.fn(),
      buildLocalEtag: vi.fn(),
      resolveIfMatchForLocal: vi.fn(() => ({ ok: true })),
      normalizeLocalRelativePathForEtag: vi.fn((pathValue: string) => pathValue),
      deleteIndexedLocalNotesByNotebook: vi.fn(),
      deleteIndexForLocalPath: vi.fn(),
      syncLocalNoteTagsMetadata: vi.fn(),
      syncLocalNotePopupRefs: vi.fn(),
      clearLocalNotebookIndexSyncForNotebook: vi.fn(),
      scanAndCacheLocalFolderTree: vi.fn(),
      syncLocalFolderWatchers: vi.fn(),
      selectLocalFolderRoot: vi.fn(async () => null),
      trashItem: vi.fn(async () => {}),
      openPath: vi.fn(async () => ''),
      deleteLocalFolderNotebook: vi.fn(() => ({ ok: true })),
    } as unknown as LocalFolderIpcDeps

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps)

    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
    const getTreeHandler = channels.get('localFolder:getTree')
    expect(getTreeHandler).toBeTruthy()

    const result = await getTreeHandler!({}, 'nb-1') as any
    expect(result).toEqual({ success: true, result: fastTree })
    expect(scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledWith(
      mount,
      {
        includePreview: false,
        sortEntries: false,
      }
    )
  })

  it('uses fast tree scan once, warms previews in background, then serves warmed cache without loops', async () => {
    vi.useFakeTimers()
    process.env.NODE_ENV = 'development'
    process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED = '1'
    process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY = '0'
    process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED = '1'
    process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS = '0'
    process.env.LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS = '5000'

    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    const mount = createMount()
    const fastTree: LocalFolderTreeResult = {
      notebook_id: mount.notebook.id,
      root_path: mount.mount.root_path,
      scanned_at: new Date().toISOString(),
      tree: [],
      files: [{
        id: 'local:nb-1:a.md',
        name: 'a',
        file_name: 'a.md',
        relative_path: 'a.md',
        folder_relative_path: '',
        folder_depth: 1,
        extension: 'md',
        size: 20,
        mtime_ms: 1000,
        root_path: mount.mount.root_path,
        preview: '',
      }],
    }
    const warmedTree: LocalFolderTreeResult = {
      ...fastTree,
      scanned_at: new Date(Date.now() + 1).toISOString(),
      files: [{
        ...fastTree.files[0],
        preview: 'hello world',
      }],
    }

    let cachedTree: LocalFolderTreeResult | null = null
    const scanAndCacheLocalFolderTreeAsync = vi.fn(async (
      _mount: LocalFolderNotebookMount,
      options?: { includePreview?: boolean }
    ): Promise<LocalFolderTreeResult> => {
      const includePreview = options?.includePreview !== false
      const nextTree = includePreview ? warmedTree : fastTree
      cachedTree = nextTree
      return nextTree
    })
    const scheduleLocalFolderWatchEvent = vi.fn()
    const ensureLocalFolderWatcher = vi.fn()

    const deps = {
      getLocalFolderMounts: vi.fn(() => [mount]),
      getLocalFolderMountByNotebookId: vi.fn(() => ({
        root_path: mount.mount.root_path,
        status: 'active',
      })),
      scanAndCacheLocalFolderTreeAsync,
      getCachedLocalFolderTree: vi.fn(() => cachedTree),
      scheduleLocalFolderWatchEvent,
      ensureLocalFolderWatcher,
      updateLocalFolderMountStatus: vi.fn(() => 'updated'),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      stopLocalFolderWatcher: vi.fn(),
      resolveMountStatusFromFsError: vi.fn(() => 'missing'),
      getLocalFolderMountByCanonicalPath: vi.fn(() => null),
      createLocalFolderNotebookMountSafe: vi.fn(),
      updateLocalFolderMountRoot: vi.fn(),
      readLocalFolderFileAsync: vi.fn(),
      saveLocalFolderFileAsync: vi.fn(),
      createLocalFolderFileAsync: vi.fn(),
      createLocalFolderAsync: vi.fn(),
      renameLocalFolderEntryAsync: vi.fn(),
      resolveLocalFolderDeleteTargetAsync: vi.fn(),
      resolveLocalFolderFilePathAsync: vi.fn(),
      readLocalFolderFile: vi.fn(),
      ensureLocalNoteIdentity: vi.fn(),
      renameLocalNoteIdentityPath: vi.fn(),
      renameLocalNoteIdentityFolderPath: vi.fn(),
      deleteLocalNoteIdentityByPath: vi.fn(),
      getLocalNoteIdentityByPath: vi.fn(() => null),
      listLocalNoteMetadata: vi.fn(() => []),
      updateLocalNoteMetadata: vi.fn(),
      renameLocalNoteMetadataPath: vi.fn(),
      renameLocalNoteMetadataFolderPath: vi.fn(),
      deleteLocalNoteMetadataByPath: vi.fn(),
      buildLocalEtag: vi.fn(),
      resolveIfMatchForLocal: vi.fn(() => ({ ok: true })),
      normalizeLocalRelativePathForEtag: vi.fn((pathValue: string) => pathValue),
      deleteIndexedLocalNotesByNotebook: vi.fn(),
      deleteIndexForLocalPath: vi.fn(),
      syncLocalNoteTagsMetadata: vi.fn(),
      syncLocalNotePopupRefs: vi.fn(),
      clearLocalNotebookIndexSyncForNotebook: vi.fn(),
      scanAndCacheLocalFolderTree: vi.fn(),
      syncLocalFolderWatchers: vi.fn(),
      selectLocalFolderRoot: vi.fn(async () => null),
      trashItem: vi.fn(async () => {}),
      openPath: vi.fn(async () => ''),
      deleteLocalFolderNotebook: vi.fn(() => ({ ok: true })),
    } as unknown as LocalFolderIpcDeps

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps)

    const getTreeHandler = channels.get('localFolder:getTree')
    expect(getTreeHandler).toBeTruthy()

    const firstResult = await getTreeHandler!({}, 'nb-1') as any
    expect(firstResult).toEqual({ success: true, result: fastTree })
    expect(scanAndCacheLocalFolderTreeAsync.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(scanAndCacheLocalFolderTreeAsync.mock.calls[0]?.[1]).toEqual({
      includePreview: false,
      sortEntries: false,
    })

    await vi.runAllTimersAsync()
    await Promise.resolve()

    expect(scanAndCacheLocalFolderTreeAsync.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(scanAndCacheLocalFolderTreeAsync.mock.calls[1]?.[1]).toEqual({ includePreview: true })
    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledTimes(1)
    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'active',
      reason: 'content_changed',
      changed_relative_path: null,
    }))
    const scanCallCountAfterWarmup = scanAndCacheLocalFolderTreeAsync.mock.calls.length

    const secondResult = await getTreeHandler!({}, 'nb-1') as any
    expect(secondResult).toEqual({ success: true, result: warmedTree })
    expect(scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(scanCallCountAfterWarmup)

    await vi.runAllTimersAsync()
    await Promise.resolve()
    expect(scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(scanCallCountAfterWarmup)
    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledTimes(1)
    expect(ensureLocalFolderWatcher).toHaveBeenCalledTimes(2)
  })
})
