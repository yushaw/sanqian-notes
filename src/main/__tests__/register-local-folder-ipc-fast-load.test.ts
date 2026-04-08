import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalFolderNotebookMount,
  LocalFolderTreeResult,
} from '../../shared/types'

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

function getHandler(channels: Map<string, Handler>, channel: string): Handler {
  const handler = channels.get(channel)
  if (!handler) {
    throw new Error(`Handler not registered for channel: ${channel}`)
  }
  return handler
}

function createMount(rootPath: string, canonicalRootPath: string = rootPath): LocalFolderNotebookMount {
  return {
    notebook: {
      id: 'nb-1',
      name: 'Test Folder',
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    mount: {
      root_path: rootPath,
      canonical_root_path: canonicalRootPath,
      status: 'active',
    },
  } as LocalFolderNotebookMount
}

function createBaseDeps(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    getLocalFolderMounts: vi.fn(() => [createMount('/tmp/root-a')]),
    getLocalFolderMountByCanonicalPath: vi.fn(() => null),
    getLocalFolderMountByNotebookId: vi.fn(() => ({ root_path: '/tmp/root-a', status: 'active' })),
    createLocalFolderNotebookMountSafe: vi.fn(),
    updateLocalFolderMountRoot: vi.fn(),
    updateLocalFolderMountStatus: vi.fn(() => 'updated'),
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
    updateLocalNoteMetadata: vi.fn(() => ({})),
    renameLocalNoteMetadataPath: vi.fn(),
    renameLocalNoteMetadataFolderPath: vi.fn(),
    deleteLocalNoteMetadataByPath: vi.fn(),
    buildLocalEtag: vi.fn(() => 'etag'),
    resolveIfMatchForLocal: vi.fn(() => ({ ok: true })),
    normalizeLocalRelativePathForEtag: vi.fn((pathValue: string) => pathValue),
    deleteIndexedLocalNotesByNotebook: vi.fn(),
    deleteIndexForLocalPath: vi.fn(),
    syncLocalNoteTagsMetadata: vi.fn(),
    syncLocalNotePopupRefs: vi.fn(),
    enqueueLocalNotebookIndexSync: vi.fn(),
    clearLocalNotebookIndexSyncForNotebook: vi.fn(),
    scanAndCacheLocalFolderTree: vi.fn(),
    scanAndCacheLocalFolderTreeAsync: vi.fn(async () => ({
      notebook_id: 'nb-1',
      files: [],
      folders: [],
    })),
    invalidateLocalFolderTreeCache: vi.fn(),
    ensureLocalFolderWatcher: vi.fn(),
    stopLocalFolderWatcher: vi.fn(),
    syncLocalFolderWatchers: vi.fn(),
    scheduleLocalFolderWatchEvent: vi.fn(),
    resolveMountStatusFromFsError: vi.fn(() => 'missing'),
    selectLocalFolderRoot: vi.fn(),
    trashItem: vi.fn(),
    openPath: vi.fn(),
    deleteLocalFolderNotebook: vi.fn(),
    ...overrides,
  }
}

function configureFastLoadEnv(delayMs: number): void {
  process.env.NODE_ENV = 'development'
  process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED = '1'
  process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY = '0'
  process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED = '1'
  process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS = String(delayMs)
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV
  delete process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED
  delete process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY
  delete process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED
  delete process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('register-local-folder-ipc fast-load warmup', () => {
  it('uses latest mount snapshot for warmup when root changes after fast getTree', async () => {
    configureFastLoadEnv(25)
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    let currentRootPath = '/tmp/root-a'
    const scanCalls: Array<{ rootPath: string; includePreview: boolean }> = []
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount(currentRootPath)]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(
        async (mount: LocalFolderNotebookMount, options?: { includePreview?: boolean }) => {
          scanCalls.push({
            rootPath: mount.mount.root_path,
            includePreview: options?.includePreview === true,
          })
          return tree
        }
      ),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')

    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: true, result: tree })
    expect(scanCalls).toEqual([
      { rootPath: '/tmp/root-a', includePreview: false },
    ])

    currentRootPath = '/tmp/root-b'
    await new Promise((resolve) => setTimeout(resolve, 80))

    const warmupCalls = scanCalls.filter((call) => call.includePreview)
    expect(warmupCalls).toEqual([
      { rootPath: '/tmp/root-b', includePreview: true },
    ])
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'content_changed',
      changed_relative_path: null,
    }))
  })

  it('dedupes warmup by notebook id when mount snapshot key changes', async () => {
    configureFastLoadEnv(30)
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    let currentRootPath = '/tmp/root-a'
    const scanCalls: Array<{ rootPath: string; includePreview: boolean }> = []
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount(currentRootPath)]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(
        async (mount: LocalFolderNotebookMount, options?: { includePreview?: boolean }) => {
          scanCalls.push({
            rootPath: mount.mount.root_path,
            includePreview: options?.includePreview === true,
          })
          return tree
        }
      ),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')

    const first = handler({}, 'nb-1')
    currentRootPath = '/tmp/root-b'
    const second = handler({}, 'nb-1')

    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: tree },
      { success: true, result: tree },
    ])
    await new Promise((resolve) => setTimeout(resolve, 90))

    const fastCalls = scanCalls.filter((call) => !call.includePreview)
    const warmupCalls = scanCalls.filter((call) => call.includePreview)
    expect(fastCalls).toEqual([
      { rootPath: '/tmp/root-a', includePreview: false },
      { rootPath: '/tmp/root-b', includePreview: false },
    ])
    expect(warmupCalls).toEqual([
      { rootPath: '/tmp/root-b', includePreview: true },
    ])
  })

  it('treats blank canonical root as root fallback so tree load key changes with root updates', async () => {
    configureFastLoadEnv(30)
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    let currentRootPath = '/tmp/root-a'
    const scanCalls: Array<{ rootPath: string; includePreview: boolean }> = []
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount(currentRootPath, '   ')]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(
        async (mount: LocalFolderNotebookMount, options?: { includePreview?: boolean }) => {
          scanCalls.push({
            rootPath: mount.mount.root_path,
            includePreview: options?.includePreview === true,
          })
          return tree
        }
      ),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')

    const first = handler({}, 'nb-1')
    currentRootPath = '/tmp/root-b'
    const second = handler({}, 'nb-1')

    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: tree },
      { success: true, result: tree },
    ])
    await new Promise((resolve) => setTimeout(resolve, 90))

    const fastCalls = scanCalls.filter((call) => !call.includePreview)
    const warmupCalls = scanCalls.filter((call) => call.includePreview)
    expect(fastCalls).toEqual([
      { rootPath: '/tmp/root-a', includePreview: false },
      { rootPath: '/tmp/root-b', includePreview: false },
    ])
    expect(warmupCalls).toEqual([
      { rootPath: '/tmp/root-b', includePreview: true },
    ])
  })

  it('invalidates stale cached tree when cached root mismatches current mount root', async () => {
    configureFastLoadEnv(0)
    process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED = '0'
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    const staleCachedTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/old-root',
      files: [],
      folders: [],
    } as unknown as LocalFolderTreeResult
    const scannedTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/root-a',
      files: [],
      folders: [],
    } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount('/tmp/root-a')]),
      getCachedLocalFolderTree: vi.fn(() => staleCachedTree),
      scanAndCacheLocalFolderTreeAsync: vi.fn(
        async () => scannedTree
      ),
      scheduleLocalFolderWatchEvent: vi.fn(),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')

    expect(result).toEqual({ success: true, result: scannedTree })
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(1)
  })

  it('reuses cached tree when cached root normalizes to current mount root', async () => {
    configureFastLoadEnv(0)
    process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED = '0'
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    const cachedTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/root-a/../root-a',
      files: [],
      folders: [],
    } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount('/tmp/root-a')]),
      getCachedLocalFolderTree: vi.fn(() => cachedTree),
      scheduleLocalFolderWatchEvent: vi.fn(),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')

    expect(result).toEqual({ success: true, result: cachedTree })
    expect(deps.scanAndCacheLocalFolderTreeAsync).not.toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).not.toHaveBeenCalled()
  })

  it('swallows stale cached-tree invalidation errors and continues scanning', async () => {
    configureFastLoadEnv(0)
    process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED = '0'
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const staleCachedTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/old-root',
      files: [],
      folders: [],
    } as unknown as LocalFolderTreeResult
    const scannedTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/root-a',
      files: [],
      folders: [],
    } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount('/tmp/root-a')]),
      getCachedLocalFolderTree: vi.fn(() => staleCachedTree),
      invalidateLocalFolderTreeCache: vi.fn(() => {
        throw new Error('cache unavailable')
      }),
      scanAndCacheLocalFolderTreeAsync: vi.fn(
        async () => scannedTree
      ),
      scheduleLocalFolderWatchEvent: vi.fn(),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')

    expect(result).toEqual({ success: true, result: scannedTree })
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('skips stale warmup event when mount root changes during preview scan', async () => {
    configureFastLoadEnv(0)
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    let currentRootPath = '/tmp/root-a'
    let resolvePreviewScan: () => void = () => {}
    let signalPreviewStarted: () => void = () => {}
    const previewStarted = new Promise<void>((resolve) => {
      signalPreviewStarted = resolve
    })
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount(currentRootPath)]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(
        async (_mount: LocalFolderNotebookMount, options?: { includePreview?: boolean }) => {
          if (options?.includePreview) {
            signalPreviewStarted()
            await new Promise<void>((resolve) => {
              resolvePreviewScan = resolve
            })
          }
          return tree
        }
      ),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')

    await expect(handler({}, 'nb-1')).resolves.toEqual({ success: true, result: tree })
    await previewStarted
    currentRootPath = '/tmp/root-b'
    resolvePreviewScan()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(deps.scheduleLocalFolderWatchEvent).not.toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
  })

  it('does not commit warmup tree cache when root changes during preview scan', async () => {
    configureFastLoadEnv(0)
    vi.resetModules()
    const { registerLocalFolderIpc } = await import('../ipc/register-local-folder-ipc')

    let currentRootPath = '/tmp/root-a'
    let resolvePreviewScan: () => void = () => {}
    let signalPreviewStarted: () => void = () => {}
    const previewStarted = new Promise<void>((resolve) => {
      signalPreviewStarted = resolve
    })
    const tree = { notebook_id: 'nb-1', root_path: '/tmp/root-a', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const deps = createBaseDeps({
      getLocalFolderMounts: vi.fn(() => [createMount(currentRootPath)]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(
        async (_mount: LocalFolderNotebookMount, _options?: { includePreview?: boolean }) => tree
      ),
      scanLocalFolderTreeAsync: vi.fn(
        async (_mount: LocalFolderNotebookMount, _options?: { includePreview?: boolean }) => {
          signalPreviewStarted()
          await new Promise<void>((resolve) => {
            resolvePreviewScan = resolve
          })
          return tree
        }
      ),
      cacheLocalFolderTree: vi.fn(),
    })

    const { channels, ipcMainLike } = createIpcMainLike()
    registerLocalFolderIpc(ipcMainLike, deps as any)
    const handler = getHandler(channels, 'localFolder:getTree')

    await expect(handler({}, 'nb-1')).resolves.toEqual({ success: true, result: tree })
    await previewStarted
    currentRootPath = '/tmp/root-b'
    resolvePreviewScan()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(deps.cacheLocalFolderTree).not.toHaveBeenCalled()
    expect(deps.scheduleLocalFolderWatchEvent).not.toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).not.toHaveBeenCalled()
  })
})
