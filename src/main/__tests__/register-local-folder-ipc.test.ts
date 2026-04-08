import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  LocalFolderCreateFolderResponse,
  LocalFolderCreateFileResponse,
  LocalFolderMount,
  LocalFolderNotebookMount,
  LocalFolderReadFileResponse,
  LocalFolderRenameEntryResponse,
  LocalFolderSaveFileResponse,
  LocalFolderTreeResult,
} from '../../shared/types'
import { registerLocalFolderIpc, type LocalFolderIpcDeps } from '../ipc/register-local-folder-ipc'

// Mock fs/promises and path for canonicalizeLocalFolderPathAsync / isSameOrChildPath
vi.mock('fs', () => ({
  promises: {
    realpath: vi.fn(),
    stat: vi.fn(),
  },
}))
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return {
    ...actual,
    resolve: vi.fn((p: string) => p),
    basename: vi.fn((p: string) => p.split('/').pop() || p),
    sep: '/',
  }
})
vi.mock('../path-compat', () => ({
  normalizeComparablePathForFileSystem: vi.fn((pathValue: string) => pathValue),
}))

import { promises as fsPromises } from 'fs'
import { normalizeComparablePathForFileSystem } from '../path-compat'

// --- Factories ---

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

function createMount(overrides: Partial<LocalFolderNotebookMount> = {}): LocalFolderNotebookMount {
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
      root_path: '/tmp/test-folder',
      canonical_root_path: '/tmp/test-folder',
      status: 'active',
    },
    ...overrides,
  } as LocalFolderNotebookMount
}

function createDeps(overrides: Partial<LocalFolderIpcDeps> = {}): LocalFolderIpcDeps {
  const localMount: LocalFolderMount = {
    notebook_id: 'nb-1',
    root_path: '/tmp/test-folder',
    canonical_root_path: '/tmp/test-folder',
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
  return {
    getLocalFolderMounts: vi.fn(() => [createMount()]),
    getLocalFolderMountByCanonicalPath: vi.fn(() => null),
    getLocalFolderMountByNotebookId: vi.fn(() => ({ root_path: '/tmp/test-folder' })),
    createLocalFolderNotebookMountSafe: vi.fn(() => ({ status: 'created' as const, mount: createMount() })),
    updateLocalFolderMountRoot: vi.fn(() => ({ status: 'updated' as const, mount: { ...localMount } })),
    updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
    readLocalFolderFileAsync: vi.fn(async () => ({
      success: true,
      result: {
        notebook_id: 'nb-1',
        relative_path: 'test.md',
        tiptap_content: '{}',
        mtime_ms: 1000,
        size: 100,
        content_hash: 'abc123',
      },
    })),
    saveLocalFolderFileAsync: vi.fn(async () => ({
      success: true,
      result: { mtime_ms: 2000, size: 200, content_hash: 'def456' },
    })),
    createLocalFolderFileAsync: vi.fn(async () => ({
      success: true,
      result: { relative_path: 'new-file.md' },
    })),
    createLocalFolderAsync: vi.fn(async () => ({
      success: true,
      result: { relative_path: 'new-folder' },
    })),
    renameLocalFolderEntryAsync: vi.fn(async () => ({
      success: true,
      result: { relative_path: 'renamed.md' },
    })),
    resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
      success: true,
      result: { absolute_path: '/tmp/test-folder/file.md', relative_path: 'file.md' },
    })),
    resolveLocalFolderFilePathAsync: vi.fn(async () => ({
      success: true,
      relative_path: 'resolved.md',
    })),
    readLocalFolderFile: vi.fn(() => ({
      success: true,
      result: { tiptap_content: '{}', mtime_ms: 1000 },
    })),
    ensureLocalNoteIdentity: vi.fn(),
    renameLocalNoteIdentityPath: vi.fn(),
    renameLocalNoteIdentityFolderPath: vi.fn(),
    deleteLocalNoteIdentityByPath: vi.fn(),
    getLocalNoteIdentityByPath: vi.fn(() => null),
    listLocalNoteMetadata: vi.fn(() => []),
    updateLocalNoteMetadata: vi.fn(() => ({ notebook_id: 'nb-1', relative_path: 'test.md' })),
    renameLocalNoteMetadataPath: vi.fn(),
    renameLocalNoteMetadataFolderPath: vi.fn(),
    deleteLocalNoteMetadataByPath: vi.fn(),
    buildLocalEtag: vi.fn(() => 'etag-123'),
    resolveIfMatchForLocal: vi.fn(() => ({ ok: true, expectedMtimeMs: 1000, expectedSize: 100 })),
    normalizeLocalRelativePathForEtag: vi.fn((p: string) => p),
    deleteIndexedLocalNotesByNotebook: vi.fn(),
    deleteIndexForLocalPath: vi.fn(),
    syncLocalNoteTagsMetadata: vi.fn(),
    syncLocalNotePopupRefs: vi.fn(),
    enqueueLocalNotebookIndexSync: vi.fn(),
    clearLocalNotebookIndexSyncForNotebook: vi.fn(),
    scanAndCacheLocalFolderTree: vi.fn(() => ({
      notebook_id: 'nb-1',
      files: [],
      folders: [],
    })),
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
    selectLocalFolderRoot: vi.fn(async () => '/tmp/selected-root'),
    trashItem: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    deleteLocalFolderNotebook: vi.fn(() => ({ ok: true as const })),
    ...overrides,
  } as unknown as LocalFolderIpcDeps
}

function setupHandlers(depsOverrides: Partial<LocalFolderIpcDeps> = {}) {
  const deps = createDeps(depsOverrides)
  const { channels, ipcMainLike } = createIpcMainLike()
  registerLocalFolderIpc(ipcMainLike, deps)
  return { channels, deps, ipcMainLike }
}

function getHandler(channels: Map<string, Handler>, channel: string): Handler {
  const handler = channels.get(channel)
  if (!handler) throw new Error(`Handler not registered for channel: ${channel}`)
  return handler
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/test-folder' as any)
  vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
  vi.mocked(normalizeComparablePathForFileSystem).mockImplementation((pathValue: string) => pathValue)
})

describe('register-local-folder-ipc', () => {
  it('registers all expected IPC handlers', () => {
    const { ipcMainLike, channels } = setupHandlers()
    // Verify key channels are registered
    expect(channels.has('localFolder:list')).toBe(true)
    expect(channels.has('localFolder:getTree')).toBe(true)
    expect(channels.has('localFolder:readFile')).toBe(true)
    expect(channels.has('localFolder:saveFile')).toBe(true)
    expect(channels.has('localFolder:createFile')).toBe(true)
    expect(channels.has('localFolder:createFolder')).toBe(true)
    expect(channels.has('localFolder:renameEntry')).toBe(true)
    expect(channels.has('localFolder:deleteEntry')).toBe(true)
    expect(channels.has('localFolder:mount')).toBe(true)
    expect(channels.has('localFolder:relink')).toBe(true)
    expect(channels.has('localFolder:unmount')).toBe(true)
    expect(ipcMainLike.handle.mock.calls.length).toBeGreaterThanOrEqual(11)
  })
})

describe('localFolder:list', () => {
  it('returns mounts list', async () => {
    const mounts = [createMount()]
    const { channels, deps } = setupHandlers({ getLocalFolderMounts: vi.fn(() => mounts) })
    const handler = getHandler(channels, 'localFolder:list')
    const result = await handler({}) as unknown
    expect(result).toEqual({
      success: true,
      result: {
        mounts,
      },
    })
    expect(deps.getLocalFolderMounts).toHaveBeenCalled()
  })

  it('returns mount path unreachable when loading mounts throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:list')
    const result = await handler({}) as unknown
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('waits for queued relink before listing mounts and uses latest root', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let currentRootPath = '/tmp/test-folder'
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const relinkHandler = getHandler(channels, 'localFolder:relink')
    const listHandler = getHandler(channels, 'localFolder:list')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const list = listHandler({})
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.getLocalFolderMounts).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, listResult] = await Promise.all([relink, list]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(listResult).toMatchObject({
      success: true,
      result: {
        mounts: [
          expect.objectContaining({
            mount: expect.objectContaining({ root_path: '/tmp/new-root' }),
          }),
        ],
      },
    })
  })

  it('waits for queued mount before listing mounts and includes the newly mounted notebook', async () => {
    let resolveMountCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-mounted-folder') {
        await new Promise<void>((resolve) => {
          resolveMountCanonical = resolve
        })
        return '/tmp/new-mounted-folder' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let mounted: LocalFolderNotebookMount | null = null
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => {
        const mounts = [createMount()]
        if (mounted) mounts.push(mounted)
        return mounts
      }),
      createLocalFolderNotebookMountSafe: vi.fn((input: {
        name: string
        icon?: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        mounted = createMount({
          notebook: {
            id: 'nb-2',
            name: input.name,
            icon: input.icon || 'logo:notes',
            source_type: 'local-folder',
            order_index: 1,
            created_at: '2026-01-01T00:00:00.000Z',
          },
          mount: {
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
          } as any,
        })
        return {
          status: 'created' as const,
          mount: mounted,
        }
      }),
    })
    const mountHandler = getHandler(channels, 'localFolder:mount')
    const listHandler = getHandler(channels, 'localFolder:list')

    const mount = mountHandler({}, {
      root_path: '/tmp/new-mounted-folder',
      name: 'Mounted Folder',
    })
    await Promise.resolve()
    await Promise.resolve()

    const list = listHandler({})
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.getLocalFolderMounts).toHaveBeenCalledTimes(0)

    resolveMountCanonical()
    const [mountResult, listResult] = await Promise.all([mount, list]) as any[]
    expect(mountResult).toMatchObject({ success: true })
    expect(listResult).toMatchObject({
      success: true,
      result: {
        mounts: expect.arrayContaining([
          expect.objectContaining({
            notebook: expect.objectContaining({ id: 'nb-2' }),
            mount: expect.objectContaining({ root_path: '/tmp/new-mounted-folder' }),
          }),
        ]),
      },
    })
  })

  it('waits for queued unmount before listing mounts and converges to empty list', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => (deleted ? [] : [createMount()])),
      createLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderCreateFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return {
          success: true,
          result: { relative_path: 'queued.md' },
        }
      }),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')
    const listHandler = getHandler(channels, 'localFolder:list')

    const createFile = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const mountReadCountBeforeList = vi.mocked(deps.getLocalFolderMounts).mock.calls.length
    const list = listHandler({})
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.getLocalFolderMounts).toHaveBeenCalledTimes(mountReadCountBeforeList)

    pendingResolves[0]?.()
    const [createResult, unmountResult, listResult] = await Promise.all([createFile, unmount, list]) as any[]
    expect(createResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(listResult).toEqual({
      success: true,
      result: {
        mounts: [],
      },
    })
    expect(deps.getLocalFolderMounts).toHaveBeenCalledTimes(mountReadCountBeforeList + 1)
  })
})

describe('localFolder:readFile', () => {
  it('returns deterministic typed error for malformed read-file input', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:readFile')

    const missingNotebookResult = await handler({}, {
      notebook_id: '   ',
      relative_path: 'test.md',
    } as any)
    expect(missingNotebookResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })

    const missingPathResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: '   ',
    } as any)
    expect(missingPathResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })

    const nullPayloadResult = await handler({}, null as any)
    expect(nullPayloadResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('preserves relative_path surrounding spaces when reading file', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:readFile')
    const relativePath = '  docs/test.md  '

    const result = await handler({}, { notebook_id: 'nb-1', relative_path: relativePath }) as any
    expect(result).toMatchObject({ success: true })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledWith(expect.anything(), relativePath)
  })

  it('returns file with etag on success', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalled()
    expect(deps.buildLocalEtag).toHaveBeenCalled()
    expect(result).toMatchObject({ success: true })
  })

  it('coalesces concurrent readFile requests for the same file', async () => {
    const pendingResolves: Array<() => void> = []
    const readResponse: LocalFolderReadFileResponse = {
      success: true,
      result: {
        id: 'nb-1:test.md',
        notebook_id: 'nb-1',
        name: 'test.md',
        file_name: 'test.md',
        relative_path: 'test.md',
        extension: 'md',
        tiptap_content: '{"type":"doc"}',
        mtime_ms: 1000,
        size: 100,
        content_hash: 'abc123',
      },
    }
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(
        (_mount: LocalFolderNotebookMount, _relativePath: string): Promise<LocalFolderReadFileResponse> =>
          new Promise((resolve) => {
            pendingResolves.push(() => resolve(readResponse))
          })
      ),
    })
    const handler = getHandler(channels, 'localFolder:readFile')

    const first = handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    const second = handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true, result: { relative_path: 'test.md' } })
    expect(secondResult).toMatchObject({ success: true, result: { relative_path: 'test.md' } })

    const third = handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)
    pendingResolves[1]?.()
    await expect(third).resolves.toMatchObject({ success: true, result: { relative_path: 'test.md' } })
  })

  it('coalesces concurrent readFile requests for aliased paths after normalization', async () => {
    const pendingResolves: Array<() => void> = []
    const readResponse: LocalFolderReadFileResponse = {
      success: true,
      result: {
        id: 'nb-1:test.md',
        notebook_id: 'nb-1',
        name: 'test.md',
        file_name: 'test.md',
        relative_path: 'test.md',
        extension: 'md',
        tiptap_content: '{"type":"doc"}',
        mtime_ms: 1000,
        size: 100,
        content_hash: 'abc123',
      },
    }
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(
        (_mount: LocalFolderNotebookMount, _relativePath: string): Promise<LocalFolderReadFileResponse> =>
          new Promise((resolve) => {
            pendingResolves.push(() => resolve(readResponse))
          })
      ),
    })
    const handler = getHandler(channels, 'localFolder:readFile')

    const first = handler({}, { notebook_id: 'nb-1', relative_path: './test.md' })
    const second = handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true, result: { relative_path: 'test.md' } })
    expect(secondResult).toMatchObject({ success: true, result: { relative_path: 'test.md' } })
  })

  it('does not coalesce readFile requests for trim-only aliases', async () => {
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(
        (_mount: LocalFolderNotebookMount, relativePath: string): Promise<LocalFolderReadFileResponse> =>
          new Promise((resolve) => {
            pendingResolves.push(() => resolve({
              success: true,
              result: {
                id: `nb-1:${relativePath}`,
                notebook_id: 'nb-1',
                name: 'test.md',
                file_name: 'test.md',
                relative_path: relativePath,
                extension: 'md',
                tiptap_content: '{"type":"doc"}',
                mtime_ms: 1000,
                size: 100,
                content_hash: 'abc123',
              },
            }))
          })
      ),
    })
    const handler = getHandler(channels, 'localFolder:readFile')

    const first = handler({}, { notebook_id: 'nb-1', relative_path: ' test.md' })
    const second = handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[0]?.()
    pendingResolves[1]?.()
    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
  })

  it('coalesces readFile requests for case-only aliases on case-insensitive path comparator', async () => {
    vi.mocked(normalizeComparablePathForFileSystem).mockImplementation((pathValue: string) =>
      pathValue.toLowerCase()
    )

    const pendingResolves: Array<() => void> = []
    const readResponse: LocalFolderReadFileResponse = {
      success: true,
      result: {
        id: 'nb-1:test.md',
        notebook_id: 'nb-1',
        name: 'test.md',
        file_name: 'test.md',
        relative_path: 'test.md',
        extension: 'md',
        tiptap_content: '{"type":"doc"}',
        mtime_ms: 1000,
        size: 100,
        content_hash: 'abc123',
      },
    }
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(
        (_mount: LocalFolderNotebookMount, _relativePath: string): Promise<LocalFolderReadFileResponse> =>
          new Promise((resolve) => {
            pendingResolves.push(() => resolve(readResponse))
          })
      ),
    })
    const handler = getHandler(channels, 'localFolder:readFile')

    const first = handler({}, { notebook_id: 'nb-1', relative_path: 'Test.md' })
    const second = handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
  })

  it('does not coalesce readFile requests when path includes parent traversal segments', async () => {
    const pendingResolves: Array<() => void> = []
    const readResponse: LocalFolderReadFileResponse = {
      success: true,
      result: {
        id: 'nb-1:test.md',
        notebook_id: 'nb-1',
        name: 'test.md',
        file_name: 'test.md',
        relative_path: 'test.md',
        extension: 'md',
        tiptap_content: '{"type":"doc"}',
        mtime_ms: 1000,
        size: 100,
        content_hash: 'abc123',
      },
    }
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(
        (_mount: LocalFolderNotebookMount, _relativePath: string): Promise<LocalFolderReadFileResponse> =>
          new Promise((resolve) => {
            pendingResolves.push(() => resolve(readResponse))
          })
      ),
    })
    const handler = getHandler(channels, 'localFolder:readFile')

    const first = handler({}, { notebook_id: 'nb-1', relative_path: 'docs/../test.md' })
    const second = handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[0]?.()
    pendingResolves[1]?.()
    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
  })

  it('waits for queued relink before reading and uses the latest mount root', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let currentRootPath = '/tmp/test-folder'
    const readCallRoots: string[] = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      readLocalFolderFileAsync: vi.fn(
        async (mount: LocalFolderNotebookMount, relativePath: string): Promise<LocalFolderReadFileResponse> => {
          readCallRoots.push(mount.mount.root_path)
          return {
            success: true,
            result: {
              id: `nb-1:${relativePath}`,
              notebook_id: 'nb-1',
              name: relativePath,
              file_name: relativePath,
              relative_path: relativePath,
              extension: 'md',
              tiptap_content: '{"type":"doc"}',
              mtime_ms: 1000,
              size: 100,
              content_hash: 'abc123',
            },
          }
        }
      ),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const readHandler = getHandler(channels, 'localFolder:readFile')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const read = readHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, readResult] = await Promise.all([relink, read]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(readResult).toMatchObject({ success: true, result: { relative_path: 'test.md' } })
    expect(readCallRoots).toEqual(['/tmp/new-root'])
  })

  it('waits for queued unmount before reading and converges to not-found', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => {
        if (deleted) {
          return []
        }
        return [createMount()]
      }),
      createLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderCreateFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return {
          success: true,
          result: { relative_path: 'queued.md' },
        }
      }),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')
    const readHandler = getHandler(channels, 'localFolder:readFile')

    const createFile = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const read = readHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [createResult, unmountResult, readResult] = await Promise.all([createFile, unmount, read]) as any[]
    expect(createResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(readResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(1)
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(0)
  })

  it('waits for queued cross-notebook deleteEntry convergence before reading affected mount', async () => {
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/test-folder/sub') {
        return '/tmp/test-folder/sub' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let affectedStatus: 'active' | 'missing' | 'permission_required' = 'active'
    const pendingResolves: Array<() => void> = []
    const sourceMount = createMount()
    const affectedMount = createMount({
      notebook: {
        id: 'nb-2',
        name: 'Affected Folder',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      mount: {
        notebook_id: 'nb-2',
        root_path: '/tmp/test-folder/sub/child',
        canonical_root_path: '/tmp/test-folder/sub/child',
        status: affectedStatus,
      },
    } as LocalFolderNotebookMount)
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        sourceMount,
        {
          ...affectedMount,
          mount: {
            ...affectedMount.mount,
            status: affectedStatus,
          },
        } as LocalFolderNotebookMount,
      ]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
      trashItem: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
      }),
      updateLocalFolderMountStatus: vi.fn((notebookId: string, status: 'active' | 'missing' | 'permission_required') => {
        if (notebookId === 'nb-2') {
          affectedStatus = status
        }
        return 'updated' as const
      }),
    })
    const deleteHandler = getHandler(channels, 'localFolder:deleteEntry')
    const readHandler = getHandler(channels, 'localFolder:readFile')

    const deleteEntry = deleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })
    for (let i = 0; i < 20 && pendingResolves.length === 0; i += 1) {
      await Promise.resolve()
    }
    expect(pendingResolves).toHaveLength(1)

    const read = readHandler({}, {
      notebook_id: 'nb-2',
      relative_path: 'test.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [deleteResult, readResult] = await Promise.all([deleteEntry, read]) as any[]
    expect(deleteResult).toMatchObject({ success: true })
    expect(readResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-2', 'missing')
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(0)
  })

  it('returns error when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('returns file-not-found when mount status is missing', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [missingMount]),
    })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.readLocalFolderFileAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable when mount status is permission_required', async () => {
    const blockedMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'permission_required' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [blockedMount]),
    })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.readLocalFolderFileAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable error when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    errorSpy.mockRestore()
  })

  it('returns unreadable error when reading local file throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(async () => { throw new Error('read failed') }),
    })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    errorSpy.mockRestore()
  })

  it('converges mount status to missing when read fails and mount root is unavailable', async () => {
    vi.mocked(fsPromises.realpath).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(async () => ({ success: false as const, errorCode: 'LOCAL_FILE_UNREADABLE' as const })),
    })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })

    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'missing')
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      clearPendingEvent: false,
    }))
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
    }))
  })

  it('success: etag build failure is swallowed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      buildLocalEtag: vi.fn(() => { throw new Error('etag failed') }),
    })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' }) as any
    expect(result.success).toBe(true)
    expect(result.result.etag).toBeUndefined()
    errorSpy.mockRestore()
  })
})

describe('localFolder:saveFile', () => {
  it('returns deterministic typed error for malformed save-file input', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:saveFile')

    const nullPayloadResult = await handler({}, null as any)
    expect(nullPayloadResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })

    const missingNotebookResult = await handler({}, {
      notebook_id: '   ',
      relative_path: 'test.md',
      tiptap_content: '{}',
    } as any)
    expect(missingNotebookResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })

    const missingPathResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: '',
      tiptap_content: '{}',
    } as any)
    expect(missingPathResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })

    const invalidContentResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: null,
    } as any)
    expect(invalidContentResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })

    const invalidIfMatchResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: { bad: true },
    } as any)
    expect(invalidIfMatchResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })

    const invalidIfMatchNullByteResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'etag\0v1',
    } as any)
    expect(invalidIfMatchNullByteResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })

    const invalidIfMatchTooLongResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'a'.repeat(1025),
    } as any)
    expect(invalidIfMatchTooLongResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })

    const invalidExpectedMtimeResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      expected_mtime_ms: Number.NaN,
    } as any)
    expect(invalidExpectedMtimeResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })

    const invalidExpectedSizeResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      expected_size: -1,
    } as any)
    expect(invalidExpectedSizeResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })

    const invalidExpectedHashResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      expected_content_hash: 123,
    } as any)
    expect(invalidExpectedHashResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })

    const invalidExpectedHashFormatResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      expected_content_hash: 'not-a-sha256',
    } as any)
    expect(invalidExpectedHashFormatResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })

    const invalidForceResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      force: 'yes',
    } as any)
    expect(invalidForceResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
  })

  it('preserves relative_path surrounding spaces when saving file', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:saveFile')
    const relativePath = '  docs/test.md  '
    const tiptapContent = '{"type":"doc"}'

    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: relativePath,
      tiptap_content: tiptapContent,
    }) as any

    expect(result).toMatchObject({ success: true })
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledWith(
      expect.anything(),
      relativePath,
      tiptapContent,
      expect.any(Object)
    )
  })

  it('saves file, invalidates cache, ensures identity, syncs tags/refs, returns etag', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc"}',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.ensureLocalNoteIdentity).toHaveBeenCalled()
    expect(deps.syncLocalNoteTagsMetadata).toHaveBeenCalled()
    expect(deps.syncLocalNotePopupRefs).toHaveBeenCalled()
    expect(deps.buildLocalEtag).toHaveBeenCalled()
  })

  it('serializes concurrent saveFile requests for the same file', async () => {
    const pendingResolves: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          _relativePath: string,
          _tiptapContent: string
        ): Promise<LocalFolderSaveFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolves.push(resolve)
          })
          active -= 1
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc"}',
    })
    const second = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc","v":2}',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const firstResult = await first as any
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[1]?.()
    const secondResult = await second as any
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(1)
  })

  it('serializes concurrent saveFile requests for aliased paths after normalization', async () => {
    const pendingResolves: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          _relativePath: string,
          _tiptapContent: string
        ): Promise<LocalFolderSaveFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolves.push(resolve)
          })
          active -= 1
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      relative_path: './test.md',
      tiptap_content: '{"type":"doc"}',
    })
    const second = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc","v":2}',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const firstResult = await first as any
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[1]?.()
    const secondResult = await second as any
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(1)
  })

  it('does not serialize saveFile requests for trim-only aliases', async () => {
    const pendingResolves: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          _relativePath: string,
          _tiptapContent: string
        ): Promise<LocalFolderSaveFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolves.push(resolve)
          })
          active -= 1
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      relative_path: ' test.md',
      tiptap_content: '{"type":"doc"}',
    })
    const second = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc","v":2}',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[0]?.()
    pendingResolves[1]?.()
    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(2)
  })

  it('serializes saveFile requests for case-only aliases on case-insensitive path comparator', async () => {
    vi.mocked(normalizeComparablePathForFileSystem).mockImplementation((pathValue: string) =>
      pathValue.toLowerCase()
    )

    const pendingResolves: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          _relativePath: string,
          _tiptapContent: string
        ): Promise<LocalFolderSaveFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolves.push(resolve)
          })
          active -= 1
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'Test.md',
      tiptap_content: '{"type":"doc"}',
    })
    const second = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc","v":2}',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const firstResult = await first as any
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[1]?.()
    const secondResult = await second as any
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(1)
  })

  it('does not serialize saveFile requests when path includes parent traversal segments', async () => {
    const pendingResolvesByPath = new Map<string, () => void>()
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          relativePath: string,
          _tiptapContent: string
        ): Promise<LocalFolderSaveFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolvesByPath.set(relativePath, resolve)
          })
          active -= 1
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'docs/../test.md',
      tiptap_content: '{"type":"doc"}',
    })
    const second = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc","v":2}',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolvesByPath.size).toBe(2)

    pendingResolvesByPath.get('docs/../test.md')?.()
    pendingResolvesByPath.get('test.md')?.()
    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(2)
  })

  it('does not serialize concurrent saveFile requests for different files', async () => {
    const pendingResolvesByPath = new Map<string, () => void>()
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          relativePath: string,
          _tiptapContent: string
        ): Promise<LocalFolderSaveFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolvesByPath.set(relativePath, resolve)
          })
          active -= 1
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'a.md',
      tiptap_content: '{"type":"doc"}',
    })
    const second = handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'b.md',
      tiptap_content: '{"type":"doc"}',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolvesByPath.size).toBe(2)

    pendingResolvesByPath.get('a.md')?.()
    pendingResolvesByPath.get('b.md')?.()

    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(2)
  })

  it('re-resolves mount after queued relink before executing later saveFile', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/new-root' as any)
    let currentRootPath = '/tmp/test-folder'
    const pendingResolves: Array<() => void> = []
    const saveCallRoots: string[] = []
    let saveCallCount = 0
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      saveLocalFolderFileAsync: vi.fn(
        async (
          mount: LocalFolderNotebookMount,
          relativePath: string,
          _tiptapContent: string
        ): Promise<LocalFolderSaveFileResponse> => {
          saveCallCount += 1
          saveCallRoots.push(mount.mount.root_path)
          if (saveCallCount === 1) {
            await new Promise<void>((resolve) => {
              pendingResolves.push(resolve)
            })
          }
          return {
            success: true,
            result: {
              mtime_ms: 2000 + saveCallCount,
              size: 200,
              content_hash: `hash-${relativePath}`,
            },
          }
        }
      ),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const saveHandler = getHandler(channels, 'localFolder:saveFile')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const firstSave = saveHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'first.md',
      tiptap_content: '{"type":"doc"}',
    })
    await Promise.resolve()
    await Promise.resolve()

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const secondSave = saveHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'second.md',
      tiptap_content: '{"type":"doc"}',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(saveCallRoots).toEqual(['/tmp/test-folder'])

    pendingResolves[0]?.()
    const [firstSaveResult, relinkResult, secondSaveResult] = await Promise.all([firstSave, relink, secondSave]) as any[]

    expect(firstSaveResult).toMatchObject({ success: true })
    expect(relinkResult).toMatchObject({ success: true })
    expect(secondSaveResult).toMatchObject({ success: true })
    expect(saveCallRoots).toEqual(['/tmp/test-folder', '/tmp/new-root'])
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(1)
  })

  it('waits for queued unmount before later saveFile and converges to not-found', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => {
        if (deleted) {
          return []
        }
        return [createMount()]
      }),
      saveLocalFolderFileAsync: vi.fn(
        async (): Promise<LocalFolderSaveFileResponse> => {
          await new Promise<void>((resolve) => {
            pendingResolves.push(resolve)
          })
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
    })
    const saveHandler = getHandler(channels, 'localFolder:saveFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')

    const firstSave = saveHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'first.md',
      tiptap_content: '{"type":"doc"}',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const secondSave = saveHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'second.md',
      tiptap_content: '{"type":"doc"}',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    pendingResolves[0]?.()
    const [firstSaveResult, unmountResult, secondSaveResult] = await Promise.all([firstSave, unmount, secondSave]) as any[]

    expect(firstSaveResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(secondSaveResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(1)
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)
  })

  it('waits for queued cross-notebook deleteEntry convergence before saving affected mount', async () => {
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/test-folder/sub') {
        return '/tmp/test-folder/sub' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let affectedStatus: 'active' | 'missing' | 'permission_required' = 'active'
    const pendingResolves: Array<() => void> = []
    const sourceMount = createMount()
    const affectedMount = createMount({
      notebook: {
        id: 'nb-2',
        name: 'Affected Folder',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      mount: {
        notebook_id: 'nb-2',
        root_path: '/tmp/test-folder/sub/child',
        canonical_root_path: '/tmp/test-folder/sub/child',
        status: affectedStatus,
      },
    } as LocalFolderNotebookMount)
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        sourceMount,
        {
          ...affectedMount,
          mount: {
            ...affectedMount.mount,
            status: affectedStatus,
          },
        } as LocalFolderNotebookMount,
      ]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
      trashItem: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
      }),
      updateLocalFolderMountStatus: vi.fn((notebookId: string, status: 'active' | 'missing' | 'permission_required') => {
        if (notebookId === 'nb-2') {
          affectedStatus = status
        }
        return 'updated' as const
      }),
    })
    const deleteHandler = getHandler(channels, 'localFolder:deleteEntry')
    const saveHandler = getHandler(channels, 'localFolder:saveFile')

    const deleteEntry = deleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })
    for (let i = 0; i < 20 && pendingResolves.length === 0; i += 1) {
      await Promise.resolve()
    }
    expect(pendingResolves).toHaveLength(1)

    const save = saveHandler({}, {
      notebook_id: 'nb-2',
      relative_path: 'affected.md',
      tiptap_content: '{"type":"doc"}',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [deleteResult, saveResult] = await Promise.all([deleteEntry, save]) as any[]
    expect(deleteResult).toMatchObject({ success: true })
    expect(saveResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-2', 'missing')
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(0)
  })

  it('returns conflict when if_match fails', async () => {
    const { channels } = setupHandlers({
      resolveIfMatchForLocal: vi.fn(() => ({ ok: false as const, error: 'if_match_mismatch' as const })),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'old-etag',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_CONFLICT' })
  })

  it('returns invalid_if_match error', async () => {
    const { channels } = setupHandlers({
      resolveIfMatchForLocal: vi.fn(() => ({ ok: false as const, error: 'invalid_if_match' as const })),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'invalid',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })
  })

  it('coalesces save if_match preflight read with concurrent readFile request', async () => {
    const pendingResolves: Array<() => void> = []
    const readResponse: LocalFolderReadFileResponse = {
      success: true,
      result: {
        id: 'nb-1:test.md',
        notebook_id: 'nb-1',
        name: 'test.md',
        file_name: 'test.md',
        relative_path: 'test.md',
        extension: 'md',
        tiptap_content: '{"type":"doc"}',
        mtime_ms: 1000,
        size: 100,
        content_hash: 'abc123',
      },
    }
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(
        (_mount: LocalFolderNotebookMount, _relativePath: string): Promise<LocalFolderReadFileResponse> =>
          new Promise((resolve) => {
            pendingResolves.push(() => resolve(readResponse))
          })
      ),
    })
    const readHandler = getHandler(channels, 'localFolder:readFile')
    const saveHandler = getHandler(channels, 'localFolder:saveFile')

    const readTask = readHandler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    const saveTask = saveHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'etag-123',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const [readResult, saveResult] = await Promise.all([readTask, saveTask]) as any[]
    expect(readResult).toMatchObject({ success: true, result: { relative_path: 'test.md' } })
    expect(saveResult).toMatchObject({ success: true })
    expect(deps.resolveIfMatchForLocal).toHaveBeenCalledTimes(1)
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)
  })

  it('skips if_match check when force is true', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'some-etag',
      force: true,
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.resolveIfMatchForLocal).not.toHaveBeenCalled()
  })

  it('returns error when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('returns file-not-found when mount status is missing', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [missingMount]),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.saveLocalFolderFileAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable when mount status is permission_required', async () => {
    const blockedMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'permission_required' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [blockedMount]),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.saveLocalFolderFileAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable error when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    errorSpy.mockRestore()
  })

  it('returns unreadable error when if_match current read throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(async () => { throw new Error('read failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'v1',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    errorSpy.mockRestore()
  })

  it('returns invalid_if_match when if_match resolver throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      resolveIfMatchForLocal: vi.fn(() => { throw new Error('if_match parse failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'broken',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' })
    errorSpy.mockRestore()
  })

  it('returns save conflict result with etag', async () => {
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(async () => ({
        success: false as const,
        errorCode: 'LOCAL_FILE_CONFLICT' as const,
        conflict: { mtime_ms: 3000, size: 300, content_hash: 'xyz' },
      })),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_CONFLICT' })
    expect(deps.buildLocalEtag).toHaveBeenCalled()
  })

  it('converges mount status to permission_required when save fails and mount root is blocked', async () => {
    vi.mocked(fsPromises.realpath).mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    const { channels, deps } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(async () => ({ success: false as const, errorCode: 'LOCAL_FILE_UNREADABLE' as const })),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'permission_required')
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      clearPendingEvent: false,
    }))
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'permission_required',
      reason: 'status_changed',
    }))
  })

  it('success: post-commit cleanup failures are swallowed after save commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('invalidate failed') }),
      ensureLocalNoteIdentity: vi.fn(() => { throw new Error('identity failed') }),
      syncLocalNoteTagsMetadata: vi.fn(() => { throw new Error('tags failed') }),
      syncLocalNotePopupRefs: vi.fn(() => { throw new Error('refs failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc"}',
    })

    expect(result).toMatchObject({ success: true })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('success: etag build failure is swallowed after save commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      buildLocalEtag: vi.fn(() => { throw new Error('etag failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{"type":"doc"}',
    }) as any

    expect(result.success).toBe(true)
    expect(result.result.etag).toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('conflict: etag build failure is swallowed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(async () => ({
        success: false as const,
        errorCode: 'LOCAL_FILE_CONFLICT' as const,
        conflict: { mtime_ms: 3000, size: 300, content_hash: 'xyz' },
      })),
      buildLocalEtag: vi.fn(() => { throw new Error('etag failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    }) as any

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('LOCAL_FILE_CONFLICT')
    expect(result.conflict?.etag).toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('if_match conflict: etag build failure is swallowed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      resolveIfMatchForLocal: vi.fn(() => ({ ok: false as const, error: 'if_match_mismatch' as const })),
      buildLocalEtag: vi.fn(() => { throw new Error('etag failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
      if_match: 'stale',
    }) as any

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('LOCAL_FILE_CONFLICT')
    expect(result.conflict?.etag).toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns write failed error when save operation throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      saveLocalFolderFileAsync: vi.fn(async () => { throw new Error('write failed') }),
    })
    const handler = getHandler(channels, 'localFolder:saveFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tiptap_content: '{}',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })
})

describe('localFolder:createFile', () => {
  it('returns deterministic typed error for malformed create-file input', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:createFile')

    const missingNotebookResult = await handler({}, {
      notebook_id: '  ',
      parent_relative_path: null,
      file_name: 'new.md',
    } as any)
    expect(missingNotebookResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })

    const invalidParentTypeResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: 123,
      file_name: 'new.md',
    } as any)
    expect(invalidParentTypeResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })

    const invalidNameResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: '   ',
    } as any)
    expect(invalidNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })

    const invalidNullByteNameResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'bad\0name.md',
    } as any)
    expect(invalidNullByteNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })

    const invalidTooLongNameResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'a'.repeat(256),
    } as any)
    expect(invalidTooLongNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })
  })

  it('preserves parent_relative_path surrounding spaces when creating file', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:createFile')
    const parentRelativePath = '  docs/projects  '

    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: parentRelativePath,
      file_name: 'new.md',
    }) as any

    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledWith(
      expect.anything(),
      parentRelativePath,
      'new.md'
    )
  })

  it('creates file, invalidates cache, ensures identity, enqueues incremental sync', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.ensureLocalNoteIdentity).toHaveBeenCalled()
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      changedRelativePath: 'new-file.md',
      immediate: true,
    }))
  })

  it('serializes concurrent createFile requests for the same mount', async () => {
    const pendingResolves: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      createLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          _parentRelativePath: string | null,
          _fileName: string
        ): Promise<LocalFolderCreateFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolves.push(resolve)
          })
          active -= 1
          return {
            success: true,
            result: { relative_path: 'new-file.md' },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:createFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'a.md',
    })
    const second = handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'b.md',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    const firstResult = await first as any
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[1]?.()
    const secondResult = await second as any
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(1)
  })

  it('does not serialize concurrent createFile requests for different mounts', async () => {
    const mountOne = createMount()
    const mountTwo = createMount({
      notebook: {
        ...mountOne.notebook,
        id: 'nb-2',
        name: 'Test Folder 2',
      },
      mount: {
        ...mountOne.mount,
        root_path: '/tmp/test-folder-2',
        canonical_root_path: '/tmp/test-folder-2',
      } as any,
    })
    const pendingResolvesByNotebook = new Map<string, () => void>()
    let active = 0
    let maxActive = 0
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [mountOne, mountTwo]),
      createLocalFolderFileAsync: vi.fn(
        async (
          mount: LocalFolderNotebookMount,
          _parentRelativePath: string | null,
          _fileName: string
        ): Promise<LocalFolderCreateFileResponse> => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise<void>((resolve) => {
            pendingResolvesByNotebook.set(mount.notebook.id, resolve)
          })
          active -= 1
          return {
            success: true,
            result: { relative_path: `${mount.notebook.id}.md` },
          }
        }
      ),
    })
    const handler = getHandler(channels, 'localFolder:createFile')

    const first = handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'a.md',
    })
    const second = handler({}, {
      notebook_id: 'nb-2',
      parent_relative_path: null,
      file_name: 'b.md',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolvesByNotebook.size).toBe(2)

    pendingResolvesByNotebook.get('nb-1')?.()
    pendingResolvesByNotebook.get('nb-2')?.()

    const [firstResult, secondResult] = await Promise.all([first, second]) as any[]
    expect(firstResult).toMatchObject({ success: true })
    expect(secondResult).toMatchObject({ success: true })
    expect(maxActive).toBe(2)
  })

  it('serializes createFile and relink mutations for the same notebook', async () => {
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      createLocalFolderFileAsync: vi.fn(
        async (
          _mount: LocalFolderNotebookMount,
          _parentRelativePath: string | null,
          _fileName: string
        ): Promise<LocalFolderCreateFileResponse> => {
          await new Promise<void>((resolve) => {
            pendingResolves.push(resolve)
          })
          return {
            success: true,
            result: { relative_path: 'new-file.md' },
          }
        }
      ),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const createRequest = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    const relinkRequest = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/new/path',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const createResult = await createRequest as any
    const relinkResult = await relinkRequest as any

    expect(createResult).toMatchObject({ success: true })
    expect(relinkResult).toMatchObject({ success: true })
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(1)
  })

  it('re-resolves mount after queued relink before executing later createFile', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/new-root' as any)
    let currentRootPath = '/tmp/test-folder'
    const pendingResolves: Array<() => void> = []
    const createCallRoots: string[] = []
    let createCallCount = 0
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      createLocalFolderFileAsync: vi.fn(
        async (
          mount: LocalFolderNotebookMount,
          _parentRelativePath: string | null,
          _fileName: string
        ): Promise<LocalFolderCreateFileResponse> => {
          createCallCount += 1
          createCallRoots.push(mount.mount.root_path)
          if (createCallCount === 1) {
            await new Promise<void>((resolve) => {
              pendingResolves.push(resolve)
            })
          }
          return {
            success: true,
            result: { relative_path: `file-${createCallCount}.md` },
          }
        }
      ),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const firstCreate = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'first.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()
    const secondCreate = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'second.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    pendingResolves[0]?.()
    const [firstCreateResult, relinkResult, secondCreateResult] = await Promise.all([firstCreate, relink, secondCreate]) as any[]

    expect(firstCreateResult).toMatchObject({ success: true })
    expect(relinkResult).toMatchObject({ success: true })
    expect(secondCreateResult).toMatchObject({ success: true })
    expect(createCallRoots).toEqual(['/tmp/test-folder', '/tmp/new-root'])
  })

  it('returns error when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('returns file-not-found when mount status is missing', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [missingMount]),
    })
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.createLocalFolderFileAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable when mount status is permission_required', async () => {
    const blockedMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'permission_required' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [blockedMount]),
    })
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.createLocalFolderFileAsync).not.toHaveBeenCalled()
  })

  it('returns write failed when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })

  it('returns write failed when create file throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      createLocalFolderFileAsync: vi.fn(async () => { throw new Error('create failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })

  it('converges mount status when create file throws and mount root is unavailable', async () => {
    vi.mocked(fsPromises.realpath).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      createLocalFolderFileAsync: vi.fn(async () => { throw new Error('create failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'missing')
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
    }))
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', { clearPendingEvent: false })
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    errorSpy.mockRestore()
  })

  it('success: post-commit cleanup failures are swallowed after create commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('invalidate failed') }),
      ensureLocalNoteIdentity: vi.fn(() => { throw new Error('identity failed') }),
      enqueueLocalNotebookIndexSync: vi.fn(() => { throw new Error('enqueue failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFile')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'new.md',
    })

    expect(result).toMatchObject({ success: true })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('localFolder:createFolder', () => {
  it('returns deterministic typed error for malformed create-folder input', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:createFolder')

    const missingNotebookResult = await handler({}, {
      notebook_id: '',
      parent_relative_path: null,
      folder_name: 'docs',
    } as any)
    expect(missingNotebookResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })

    const invalidParentTypeResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: {},
      folder_name: 'docs',
    } as any)
    expect(invalidParentTypeResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })

    const invalidNameResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: '   ',
    } as any)
    expect(invalidNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })

    const invalidNullByteNameResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'bad\0folder',
    } as any)
    expect(invalidNullByteNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })

    const invalidTooLongNameResult = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'a'.repeat(256),
    } as any)
    expect(invalidTooLongNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })
  })

  it('preserves parent_relative_path surrounding spaces when creating folder', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:createFolder')
    const parentRelativePath = '  docs/projects  '

    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: parentRelativePath,
      folder_name: 'new-folder',
    }) as any

    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderAsync).toHaveBeenCalledWith(
      expect.anything(),
      parentRelativePath,
      'new-folder'
    )
  })

  it('creates folder and invalidates cache', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })

    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderAsync).toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
  })

  it('re-resolves mount after queued relink before executing later createFolder', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/new-root' as any)
    let currentRootPath = '/tmp/test-folder'
    const pendingResolves: Array<() => void> = []
    const createFolderCallRoots: string[] = []
    let createFolderCallCount = 0
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      createLocalFolderAsync: vi.fn(
        async (
          mount: LocalFolderNotebookMount,
          _parentRelativePath: string | null,
          _folderName: string
        ): Promise<LocalFolderCreateFolderResponse> => {
          createFolderCallCount += 1
          createFolderCallRoots.push(mount.mount.root_path)
          if (createFolderCallCount === 1) {
            await new Promise<void>((resolve) => {
              pendingResolves.push(resolve)
            })
          }
          return {
            success: true,
            result: { relative_path: `folder-${createFolderCallCount}` },
          }
        }
      ),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const createFolderHandler = getHandler(channels, 'localFolder:createFolder')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const firstCreateFolder = createFolderHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'first-folder',
    })
    await Promise.resolve()
    await Promise.resolve()

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const secondCreateFolder = createFolderHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'second-folder',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(createFolderCallRoots).toEqual(['/tmp/test-folder'])

    pendingResolves[0]?.()
    const [firstCreateFolderResult, relinkResult, secondCreateFolderResult] = await Promise.all([
      firstCreateFolder,
      relink,
      secondCreateFolder,
    ]) as any[]

    expect(firstCreateFolderResult).toMatchObject({ success: true })
    expect(relinkResult).toMatchObject({ success: true })
    expect(secondCreateFolderResult).toMatchObject({ success: true })
    expect(createFolderCallRoots).toEqual(['/tmp/test-folder', '/tmp/new-root'])
  })

  it('success: post-commit cleanup failure is swallowed after create commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('invalidate failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })

    expect(result).toMatchObject({ success: true })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns error when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
  })

  it('returns folder-not-found when mount status is missing', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [missingMount]),
    })
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(deps.createLocalFolderAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable when mount status is permission_required', async () => {
    const blockedMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'permission_required' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [blockedMount]),
    })
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.createLocalFolderAsync).not.toHaveBeenCalled()
  })

  it('returns write failed when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })

  it('returns write failed when create folder throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      createLocalFolderAsync: vi.fn(async () => { throw new Error('create failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })

  it('converges mount status when create folder throws and mount root is blocked', async () => {
    vi.mocked(fsPromises.stat).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      createLocalFolderAsync: vi.fn(async () => { throw new Error('create failed') }),
    })
    const handler = getHandler(channels, 'localFolder:createFolder')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      folder_name: 'new-folder',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'permission_required')
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'permission_required',
      reason: 'status_changed',
    }))
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', { clearPendingEvent: false })
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    errorSpy.mockRestore()
  })
})

describe('localFolder:renameEntry', () => {
  it('returns deterministic typed error for malformed rename input', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:renameEntry')

    const invalidKindResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'new.md',
      kind: 'unknown',
    } as any)
    expect(invalidKindResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })

    const missingPathResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: '   ',
      new_name: 'new.md',
      kind: 'file',
    } as any)
    expect(missingPathResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })

    const invalidNameResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: '',
      kind: 'file',
    } as any)
    expect(invalidNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })

    const invalidNullByteNameResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'new\0name.md',
      kind: 'file',
    } as any)
    expect(invalidNullByteNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })

    const invalidTooLongNameResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'a'.repeat(256),
      kind: 'file',
    } as any)
    expect(invalidTooLongNameResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' })
  })

  it('preserves relative_path surrounding spaces when renaming entry', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const relativePath = '  docs/old.md  '

    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: relativePath,
      new_name: 'renamed.md',
      kind: 'file',
    }) as any

    expect(result).toMatchObject({ success: true })
    expect(deps.renameLocalFolderEntryAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        notebook_id: 'nb-1',
        relative_path: relativePath,
        kind: 'file',
        new_name: 'renamed.md',
      })
    )
  })

  it('file rename: renames metadata + identity, deletes old index, enqueues sync', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'renamed.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.renameLocalNoteMetadataPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      from_relative_path: 'old.md',
      to_relative_path: 'renamed.md',
    })
    expect(deps.renameLocalNoteIdentityPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      from_relative_path: 'old.md',
      to_relative_path: 'renamed.md',
    })
    expect(deps.deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'old.md')
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      changedRelativePath: 'renamed.md',
      immediate: true,
    }))
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
  })

  it('re-resolves mount after queued relink before executing later renameEntry', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/new-root' as any)
    let currentRootPath = '/tmp/test-folder'
    const pendingResolves: Array<() => void> = []
    const renameCallRoots: string[] = []
    let renameCallCount = 0
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      renameLocalFolderEntryAsync: vi.fn(
        async (
          mount: LocalFolderNotebookMount,
          _renameInput: {
            notebook_id: string
            relative_path: string
            new_name: string
            kind: 'file' | 'folder'
          }
        ): Promise<LocalFolderRenameEntryResponse> => {
          renameCallCount += 1
          renameCallRoots.push(mount.mount.root_path)
          if (renameCallCount === 1) {
            await new Promise<void>((resolve) => {
              pendingResolves.push(resolve)
            })
          }
          return {
            success: true,
            result: { relative_path: `renamed-${renameCallCount}.md` },
          }
        }
      ),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const renameHandler = getHandler(channels, 'localFolder:renameEntry')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const firstRename = renameHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old-a.md',
      new_name: 'renamed-a.md',
      kind: 'file',
    })
    await Promise.resolve()
    await Promise.resolve()

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const secondRename = renameHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old-b.md',
      new_name: 'renamed-b.md',
      kind: 'file',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(renameCallRoots).toEqual(['/tmp/test-folder'])

    pendingResolves[0]?.()
    const [firstRenameResult, relinkResult, secondRenameResult] = await Promise.all([firstRename, relink, secondRename]) as any[]

    expect(firstRenameResult).toMatchObject({ success: true })
    expect(relinkResult).toMatchObject({ success: true })
    expect(secondRenameResult).toMatchObject({ success: true })
    expect(renameCallRoots).toEqual(['/tmp/test-folder', '/tmp/new-root'])
  })

  it('folder rename: renames folder metadata + identity, enqueues full sync', async () => {
    const { channels, deps } = setupHandlers({
      renameLocalFolderEntryAsync: vi.fn(async () => ({
        success: true as const,
        result: { relative_path: 'renamed-folder' },
      })),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old-folder',
      new_name: 'renamed-folder',
      kind: 'folder',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.renameLocalNoteMetadataFolderPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      from_relative_folder_path: 'old-folder',
      to_relative_folder_path: 'renamed-folder',
    })
    expect(deps.renameLocalNoteIdentityFolderPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      from_relative_folder_path: 'old-folder',
      to_relative_folder_path: 'renamed-folder',
    })
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      immediate: true,
    })
  })

  it('folder rename: converges nested affected mount status to missing after commit', async () => {
    const sourceMount = createMount()
    const affectedMount = createMount({
      notebook: {
        ...sourceMount.notebook,
        id: 'nb-2',
        name: 'Nested Notebook',
      } as any,
      mount: {
        root_path: '/tmp/test-folder/old-folder',
        canonical_root_path: '/tmp/test-folder/old-folder',
        status: 'active',
      } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [sourceMount, affectedMount]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: {
          absolute_path: '/tmp/test-folder/old-folder',
          relative_path: 'old-folder',
        },
      })),
      renameLocalFolderEntryAsync: vi.fn(async () => ({
        success: true as const,
        result: { relative_path: 'renamed-folder' },
      })),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old-folder',
      new_name: 'renamed-folder',
      kind: 'folder',
    })

    expect(result).toMatchObject({ success: true })
    expect(deps.resolveLocalFolderDeleteTargetAsync).toHaveBeenCalledWith(expect.objectContaining({
      notebook: expect.objectContaining({ id: 'nb-1' }),
    }), {
      notebook_id: 'nb-1',
      relative_path: 'old-folder',
      kind: 'folder',
    })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-2', 'missing')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-2')
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-2')
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-2',
      status: 'missing',
      reason: 'status_changed',
    }))
  })

  it('metadata migration error: returns result with metadataWarning', async () => {
    const { channels } = setupHandlers({
      renameLocalNoteMetadataPath: vi.fn(() => { throw new Error('migration failed') }),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'renamed.md',
      kind: 'file',
    }) as any
    expect(result.success).toBe(true)
    expect(result.metadataWarning).toContain('migration failed')
  })

  it('returns error when mount not found (file)', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'new.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('returns kind-specific not-found when mount status is missing', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [missingMount]),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const fileResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'new.md',
      kind: 'file',
    })
    const folderResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'docs',
      new_name: 'docs2',
      kind: 'folder',
    })
    expect(fileResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(folderResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(deps.renameLocalFolderEntryAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable when mount status is permission_required', async () => {
    const blockedMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'permission_required' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [blockedMount]),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'renamed.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.renameLocalFolderEntryAsync).not.toHaveBeenCalled()
  })

  it('returns write failed when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'renamed.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })

  it('returns write failed when rename operation throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      renameLocalFolderEntryAsync: vi.fn(async () => { throw new Error('rename failed') }),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'renamed.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })

  it('converges mount status when rename throws and mount root is unavailable', async () => {
    vi.mocked(fsPromises.realpath).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      renameLocalFolderEntryAsync: vi.fn(async () => { throw new Error('rename failed') }),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'renamed.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'missing')
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
    }))
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', { clearPendingEvent: false })
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    errorSpy.mockRestore()
  })

  it('file rename: post-commit cleanup failures are swallowed after rename commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('invalidate failed') }),
      deleteIndexForLocalPath: vi.fn(() => { throw new Error('delete index failed') }),
      enqueueLocalNotebookIndexSync: vi.fn(() => { throw new Error('enqueue failed') }),
    })
    const handler = getHandler(channels, 'localFolder:renameEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old.md',
      new_name: 'renamed.md',
      kind: 'file',
    })

    expect(result).toMatchObject({ success: true })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('localFolder:deleteEntry', () => {
  it('returns deterministic typed error for malformed delete input', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:deleteEntry')

    const invalidKindResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'unknown',
    } as any)
    expect(invalidKindResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })

    const missingPathResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: '   ',
      kind: 'file',
    } as any)
    expect(missingPathResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('preserves relative_path surrounding spaces when deleting entry', async () => {
    const { channels, deps } = setupHandlers({
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/file.md', relative_path: 'file.md' },
      })),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const relativePath = '  docs/file.md  '

    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: relativePath,
      kind: 'file',
    }) as any

    expect(result).toMatchObject({ success: true })
    expect(deps.resolveLocalFolderDeleteTargetAsync).toHaveBeenCalledWith(
      expect.anything(),
      {
        notebook_id: 'nb-1',
        relative_path: relativePath,
        kind: 'file',
      }
    )
  })

  it('returns delete failed when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })
    errorSpy.mockRestore()
  })

  it('returns kind-specific not-found when mount status is missing', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [missingMount]),
    })
    const handler = getHandler(channels, 'localFolder:analyzeDelete')
    const fileResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    const folderResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'folder',
      kind: 'folder',
    })
    expect(fileResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(folderResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(deps.resolveLocalFolderDeleteTargetAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable when mount status is permission_required', async () => {
    const blockedMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'permission_required' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [blockedMount]),
    })
    const handler = getHandler(channels, 'localFolder:analyzeDelete')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.resolveLocalFolderDeleteTargetAsync).not.toHaveBeenCalled()
  })

  it('returns kind-specific not-found when mount status is missing', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [missingMount]),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const fileResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    const folderResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'folder',
      kind: 'folder',
    })
    expect(fileResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(folderResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(deps.resolveLocalFolderDeleteTargetAsync).not.toHaveBeenCalled()
  })

  it('returns unreadable when mount status is permission_required', async () => {
    const blockedMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'permission_required' } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [blockedMount]),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(deps.resolveLocalFolderDeleteTargetAsync).not.toHaveBeenCalled()
  })

  it('returns delete failed when target resolution throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => { throw new Error('resolve failed') }),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })
    errorSpy.mockRestore()
  })

  it('file delete: trashes, deletes metadata/identity, deletes index', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.trashItem).toHaveBeenCalledWith('/tmp/test-folder/file.md')
    expect(deps.deleteLocalNoteMetadataByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(deps.deleteLocalNoteIdentityByPath).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(deps.deleteIndexForLocalPath).toHaveBeenCalledWith('nb-1', 'file.md', expect.anything())
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
  })

  it('re-resolves mount after queued relink before executing later deleteEntry', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/new-root' as any)
    let currentRootPath = '/tmp/test-folder'
    const pendingResolves: Array<() => void> = []
    const deleteCallRoots: string[] = []
    let deleteCallCount = 0
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(
        async (
          mount: LocalFolderNotebookMount,
          input: { relative_path: string }
        ): Promise<Awaited<ReturnType<LocalFolderIpcDeps['resolveLocalFolderDeleteTargetAsync']>>> => {
          deleteCallCount += 1
          deleteCallRoots.push(mount.mount.root_path)
          if (deleteCallCount === 1) {
            await new Promise<void>((resolve) => {
              pendingResolves.push(resolve)
            })
          }
          return {
            success: true,
            result: {
              absolute_path: `${mount.mount.root_path}/${input.relative_path}`,
              relative_path: input.relative_path,
            },
          }
        }
      ),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const deleteHandler = getHandler(channels, 'localFolder:deleteEntry')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const firstDelete = deleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old-a.md',
      kind: 'file',
    })
    await Promise.resolve()
    await Promise.resolve()

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const secondDelete = deleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'old-b.md',
      kind: 'file',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deleteCallRoots).toEqual(['/tmp/test-folder'])

    pendingResolves[0]?.()
    const [firstDeleteResult, relinkResult, secondDeleteResult] = await Promise.all([firstDelete, relink, secondDelete]) as any[]

    expect(firstDeleteResult).toMatchObject({ success: true })
    expect(relinkResult).toMatchObject({ success: true })
    expect(secondDeleteResult).toMatchObject({ success: true })
    expect(deleteCallRoots).toEqual(['/tmp/test-folder', '/tmp/new-root'])
  })

  it('waits for in-flight cross-notebook save before executing deleteEntry mutation', async () => {
    const pendingSaveResolves: Array<() => void> = []
    const sourceMount = createMount()
    const secondaryMount = createMount({
      notebook: {
        id: 'nb-2',
        name: 'Second Folder',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      mount: {
        notebook_id: 'nb-2',
        root_path: '/tmp/second-folder',
        canonical_root_path: '/tmp/second-folder',
        status: 'active',
      },
    } as LocalFolderNotebookMount)

    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [sourceMount, secondaryMount]),
      saveLocalFolderFileAsync: vi.fn(
        async (): Promise<LocalFolderSaveFileResponse> => {
          await new Promise<void>((resolve) => {
            pendingSaveResolves.push(resolve)
          })
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
    })

    const saveHandler = getHandler(channels, 'localFolder:saveFile')
    const deleteHandler = getHandler(channels, 'localFolder:deleteEntry')

    const save = saveHandler({}, {
      notebook_id: 'nb-2',
      relative_path: 'note.md',
      tiptap_content: '{"type":"doc"}',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const deleteEntry = deleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.trashItem).toHaveBeenCalledTimes(0)

    pendingSaveResolves[0]?.()
    const [saveResult, deleteResult] = await Promise.all([save, deleteEntry]) as any[]
    expect(saveResult).toMatchObject({ success: true })
    expect(deleteResult).toMatchObject({ success: true })
    expect(deps.trashItem).toHaveBeenCalledWith('/tmp/test-folder/sub')
  })

  it('does not wait for in-flight cross-notebook save before executing file deleteEntry mutation', async () => {
    const pendingSaveResolves: Array<() => void> = []
    const sourceMount = createMount()
    const secondaryMount = createMount({
      notebook: {
        id: 'nb-2',
        name: 'Second Folder',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      mount: {
        notebook_id: 'nb-2',
        root_path: '/tmp/second-folder',
        canonical_root_path: '/tmp/second-folder',
        status: 'active',
      },
    } as LocalFolderNotebookMount)

    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [sourceMount, secondaryMount]),
      saveLocalFolderFileAsync: vi.fn(
        async (): Promise<LocalFolderSaveFileResponse> => {
          await new Promise<void>((resolve) => {
            pendingSaveResolves.push(resolve)
          })
          return {
            success: true,
            result: {
              mtime_ms: 2000,
              size: 200,
              content_hash: 'def456',
            },
          }
        }
      ),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/file.md', relative_path: 'file.md' },
      })),
    })

    const saveHandler = getHandler(channels, 'localFolder:saveFile')
    const deleteHandler = getHandler(channels, 'localFolder:deleteEntry')

    const save = saveHandler({}, {
      notebook_id: 'nb-2',
      relative_path: 'note.md',
      tiptap_content: '{"type":"doc"}',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.saveLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const deleteEntry = deleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    const trashItemMock = vi.mocked(deps.trashItem)
    let deleteStarted = false
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve()
      await Promise.resolve()
      if (trashItemMock.mock.calls.some(([path]) => path === '/tmp/test-folder/file.md')) {
        deleteStarted = true
        break
      }
    }
    expect(deleteStarted).toBe(true)

    pendingSaveResolves[0]?.()
    const [saveResult, deleteResult] = await Promise.all([save, deleteEntry]) as any[]
    expect(saveResult).toMatchObject({ success: true })
    expect(deleteResult).toMatchObject({ success: true })
  })

  it('file delete: post-commit cleanup failures are swallowed after delete commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      deleteLocalNoteMetadataByPath: vi.fn(() => { throw new Error('metadata failed') }),
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('cache failed') }),
      deleteIndexForLocalPath: vi.fn(() => { throw new Error('index failed') }),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })

    expect(result).toMatchObject({ success: true })
    expect(deps.trashItem).toHaveBeenCalledWith('/tmp/test-folder/file.md')
    expect(deps.deleteLocalNoteMetadataByPath).toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.deleteIndexForLocalPath).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('file delete: keeps success when identity lookup throws before delete commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      getLocalNoteIdentityByPath: vi.fn(() => { throw new Error('identity lookup failed') }),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })

    expect(result).toMatchObject({ success: true })
    expect(deps.trashItem).toHaveBeenCalledWith('/tmp/test-folder/file.md')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('folder delete: trashes, deletes all notebook indexes, enqueues full sync', async () => {
    const { channels, deps } = setupHandlers({
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.trashItem).toHaveBeenCalledWith('/tmp/test-folder/sub')
    expect(deps.deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      immediate: true,
    })
  })

  it('folder delete: does not emit affected mount status_changed when status persistence is rejected', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/test-folder/sub' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    const sourceMount = createMount()
    const affectedMount = createMount({
      notebook: {
        id: 'nb-2',
        name: 'Affected Folder',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      mount: {
        notebook_id: 'nb-2',
        root_path: '/tmp/test-folder/sub/child',
        canonical_root_path: '/tmp/test-folder/sub/child',
        status: 'active',
      },
    } as LocalFolderNotebookMount)

    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [sourceMount, affectedMount]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
      updateLocalFolderMountStatus: vi.fn((notebookId: string) =>
        notebookId !== 'nb-2' ? 'updated' as const : 'not_found' as const
      ),
    })

    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })

    expect(result).toMatchObject({ success: true })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-2', 'missing')
    expect(deps.scheduleLocalFolderWatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-2',
      status: 'missing',
      reason: 'status_changed',
    }))
    expect(deps.enqueueLocalNotebookIndexSync).not.toHaveBeenCalledWith('nb-2', expect.objectContaining({
      full: true,
      immediate: true,
    }))
  })

  it('folder delete: keeps success when affected mount status persistence throws', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/test-folder/sub' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const sourceMount = createMount()
    const affectedMount = createMount({
      notebook: {
        id: 'nb-2',
        name: 'Affected Folder',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      mount: {
        notebook_id: 'nb-2',
        root_path: '/tmp/test-folder/sub/child',
        canonical_root_path: '/tmp/test-folder/sub/child',
        status: 'active',
      },
    } as LocalFolderNotebookMount)

    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [sourceMount, affectedMount]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
      updateLocalFolderMountStatus: vi.fn((notebookId: string) => {
        if (notebookId === 'nb-2') throw new Error('db unavailable')
        return 'updated' as const
      }),
    })

    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })

    expect(result).toMatchObject({ success: true })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-2', 'missing')
    expect(deps.scheduleLocalFolderWatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-2',
      status: 'missing',
      reason: 'status_changed',
    }))
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('folder delete: impact analysis failure is swallowed and delete still succeeds', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/test-folder/sub' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const getMounts = vi.fn()
      .mockReturnValueOnce([createMount()])
      .mockImplementationOnce(() => { throw new Error('impact analysis failed') })

    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: getMounts as unknown as LocalFolderIpcDeps['getLocalFolderMounts'],
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
    })

    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })

    expect(result).toMatchObject({
      success: true,
      result: { affected_mounts: [] },
    })
    expect(deps.trashItem).toHaveBeenCalledWith('/tmp/test-folder/sub')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('folder delete: still persists affected mount missing status when watcher stop fails', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/test-folder/sub' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const sourceMount = createMount()
    const affectedMount = createMount({
      notebook: {
        id: 'nb-2',
        name: 'Affected Folder',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      mount: {
        notebook_id: 'nb-2',
        root_path: '/tmp/test-folder/sub/child',
        canonical_root_path: '/tmp/test-folder/sub/child',
        status: 'active',
      },
    } as LocalFolderNotebookMount)

    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [sourceMount, affectedMount]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
      stopLocalFolderWatcher: vi.fn((notebookId: string) => {
        if (notebookId === 'nb-2') throw new Error('watcher stop failed')
      }),
    })

    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })

    expect(result).toMatchObject({ success: true })
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-2')
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-2', 'missing')
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-2',
      status: 'missing',
      reason: 'status_changed',
    }))
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-2', expect.objectContaining({
      full: true,
      immediate: true,
    }))
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('waits for queued mount before deleteEntry impact analysis and converges affected mount status', async () => {
    let resolveMountCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/test-folder/sub/child') {
        await new Promise<void>((resolve) => {
          resolveMountCanonical = resolve
        })
        return '/tmp/test-folder/sub/child' as any
      }
      return pathInput as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    const mountTimestamp = '2026-01-01T00:00:00.000Z'
    const mountsByNotebook = new Map<string, LocalFolderNotebookMount>()
    mountsByNotebook.set('nb-1', createMount())
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => Array.from(mountsByNotebook.values())),
      getLocalFolderMountByCanonicalPath: vi.fn((canonicalPath: string) => {
        for (const mount of mountsByNotebook.values()) {
          if (mount.mount.canonical_root_path === canonicalPath) {
            return {
              notebook_id: mount.notebook.id,
              root_path: mount.mount.root_path,
              canonical_root_path: mount.mount.canonical_root_path,
              status: mount.mount.status,
              created_at: mountTimestamp,
              updated_at: mountTimestamp,
            }
          }
        }
        return null
      }),
      createLocalFolderNotebookMountSafe: vi.fn((input: {
        name: string
        icon?: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        const mounted = createMount({
          notebook: {
            id: 'nb-2',
            name: input.name,
            icon: input.icon || 'logo:notes',
            source_type: 'local-folder',
            order_index: 1,
            created_at: mountTimestamp,
          },
          mount: {
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
          } as any,
        })
        mountsByNotebook.set('nb-2', mounted)
        return {
          status: 'created' as const,
          mount: mounted,
        }
      }),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: {
          absolute_path: '/tmp/test-folder/sub',
          relative_path: 'sub',
        },
      })),
      updateLocalFolderMountStatus: vi.fn((notebookId: string, status: 'active' | 'missing' | 'permission_required') => {
        const mount = mountsByNotebook.get(notebookId)
        if (mount) {
          mount.mount.status = status
        }
        return 'updated' as const
      }),
    })
    const mountHandler = getHandler(channels, 'localFolder:mount')
    const deleteHandler = getHandler(channels, 'localFolder:deleteEntry')

    const mount = mountHandler({}, {
      root_path: '/tmp/test-folder/sub/child',
      name: 'Nested Folder',
    })
    await Promise.resolve()
    await Promise.resolve()

    const deleteEntry = deleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.trashItem).toHaveBeenCalledTimes(0)

    resolveMountCanonical()
    const [mountResult, deleteResult] = await Promise.all([mount, deleteEntry]) as any[]
    expect(mountResult).toMatchObject({ success: true, result: { notebook: { id: 'nb-2' } } })
    expect(deleteResult).toMatchObject({
      success: true,
      result: {
        affected_mounts: [
          expect.objectContaining({ notebook_id: 'nb-2' }),
        ],
      },
    })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-2', 'missing')
  })

  it('trash failure: returns error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      trashItem: vi.fn(async () => { throw new Error('trash failed') }),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })
    errorSpy.mockRestore()
  })

  it('converges mount status when trash throws and mount root is blocked', async () => {
    vi.mocked(fsPromises.stat).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      trashItem: vi.fn(async () => { throw new Error('trash failed') }),
    })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'permission_required')
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'permission_required',
      reason: 'status_changed',
    }))
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', { clearPendingEvent: false })
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    errorSpy.mockRestore()
  })

  it('returns error when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:deleteEntry')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })
})

describe('localFolder:analyzeDelete', () => {
  it('returns deterministic typed error for malformed analyze-delete input', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:analyzeDelete')

    const invalidKindResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'docs',
      kind: 'unknown',
    } as any)
    expect(invalidKindResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })

    const missingPathResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: '',
      kind: 'folder',
    } as any)
    expect(missingPathResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
  })

  it('success: returns affected mounts payload', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:analyzeDelete')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toEqual({
      success: true,
      result: { affected_mounts: [] },
    })
  })

  it('waits for queued relink before analyzeDelete and uses latest mount root', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let currentRootPath = '/tmp/test-folder'
    const targetResolveRoots: string[] = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async (mount: LocalFolderNotebookMount, input) => {
        targetResolveRoots.push(mount.mount.root_path)
        return {
          success: true as const,
          result: {
            absolute_path: `${mount.mount.root_path}/${input.relative_path}`,
            relative_path: input.relative_path,
          },
        }
      }),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const relinkHandler = getHandler(channels, 'localFolder:relink')
    const analyzeDeleteHandler = getHandler(channels, 'localFolder:analyzeDelete')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const analyzeDelete = analyzeDeleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.resolveLocalFolderDeleteTargetAsync).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, analyzeResult] = await Promise.all([relink, analyzeDelete]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(analyzeResult).toEqual({
      success: true,
      result: { affected_mounts: [] },
    })
    expect(targetResolveRoots).toEqual(['/tmp/new-root'])
  })

  it('waits for queued unmount before analyzeDelete and converges to not-found', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => {
        if (deleted) return []
        return [createMount()]
      }),
      createLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderCreateFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return {
          success: true,
          result: { relative_path: 'queued.md' },
        }
      }),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')
    const analyzeDeleteHandler = getHandler(channels, 'localFolder:analyzeDelete')

    const createFile = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const analyzeDelete = analyzeDeleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.resolveLocalFolderDeleteTargetAsync).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [createResult, unmountResult, analyzeResult] = await Promise.all([createFile, unmount, analyzeDelete]) as any[]
    expect(createResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(analyzeResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(1)
    expect(deps.resolveLocalFolderDeleteTargetAsync).toHaveBeenCalledTimes(0)
  })

  it('waits for queued mount before analyzeDelete impact analysis and includes newly mounted notebook', async () => {
    let resolveMountCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/test-folder/sub/child') {
        await new Promise<void>((resolve) => {
          resolveMountCanonical = resolve
        })
        return '/tmp/test-folder/sub/child' as any
      }
      return pathInput as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    const mountTimestamp = '2026-01-01T00:00:00.000Z'
    const mountsByNotebook = new Map<string, LocalFolderNotebookMount>()
    mountsByNotebook.set('nb-1', createMount())
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => Array.from(mountsByNotebook.values())),
      getLocalFolderMountByCanonicalPath: vi.fn((canonicalPath: string) => {
        for (const mount of mountsByNotebook.values()) {
          if (mount.mount.canonical_root_path === canonicalPath) {
            return {
              notebook_id: mount.notebook.id,
              root_path: mount.mount.root_path,
              canonical_root_path: mount.mount.canonical_root_path,
              status: mount.mount.status,
              created_at: mountTimestamp,
              updated_at: mountTimestamp,
            }
          }
        }
        return null
      }),
      createLocalFolderNotebookMountSafe: vi.fn((input: {
        name: string
        icon?: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        const mounted = createMount({
          notebook: {
            id: 'nb-2',
            name: input.name,
            icon: input.icon || 'logo:notes',
            source_type: 'local-folder',
            order_index: 1,
            created_at: mountTimestamp,
          },
          mount: {
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
          } as any,
        })
        mountsByNotebook.set('nb-2', mounted)
        return {
          status: 'created' as const,
          mount: mounted,
        }
      }),
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: {
          absolute_path: '/tmp/test-folder/sub',
          relative_path: 'sub',
        },
      })),
    })
    const mountHandler = getHandler(channels, 'localFolder:mount')
    const analyzeDeleteHandler = getHandler(channels, 'localFolder:analyzeDelete')

    const mount = mountHandler({}, {
      root_path: '/tmp/test-folder/sub/child',
      name: 'Nested Folder',
    })
    await Promise.resolve()
    await Promise.resolve()

    const analyzeDelete = analyzeDeleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.resolveLocalFolderDeleteTargetAsync).toHaveBeenCalledTimes(0)

    resolveMountCanonical()
    const [mountResult, analyzeResult] = await Promise.all([mount, analyzeDelete]) as any[]
    expect(mountResult).toMatchObject({ success: true, result: { notebook: { id: 'nb-2' } } })
    expect(analyzeResult).toMatchObject({
      success: true,
      result: {
        affected_mounts: [
          expect.objectContaining({ notebook_id: 'nb-2' }),
        ],
      },
    })
  })

  it('returns delete failed when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:analyzeDelete')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })
    errorSpy.mockRestore()
  })

  it('returns delete failed when target resolution throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => { throw new Error('resolve failed') }),
    })
    const handler = getHandler(channels, 'localFolder:analyzeDelete')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })
    errorSpy.mockRestore()
  })

  it('returns delete failed when impact analysis throws', async () => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/tmp/test-folder/sub' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const getMounts = vi.fn()
      .mockReturnValueOnce([createMount()])
      .mockImplementationOnce(() => { throw new Error('impact analysis failed') })

    const { channels } = setupHandlers({
      getLocalFolderMounts: getMounts as unknown as LocalFolderIpcDeps['getLocalFolderMounts'],
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => ({
        success: true as const,
        result: { absolute_path: '/tmp/test-folder/sub', relative_path: 'sub' },
      })),
    })
    const handler = getHandler(channels, 'localFolder:analyzeDelete')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'sub',
      kind: 'folder',
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' })
    errorSpy.mockRestore()
  })
})

describe('localFolder:selectRoot', () => {
  it('returns selected root path from dependency', async () => {
    const { channels } = setupHandlers({
      selectLocalFolderRoot: vi.fn(async () => '/tmp/chosen-root'),
    })
    const handler = getHandler(channels, 'localFolder:selectRoot')
    const result = await handler({})
    expect(result).toEqual({ success: true, root_path: '/tmp/chosen-root' })
  })

  it('returns canceled when user does not choose directory', async () => {
    const { channels } = setupHandlers({
      selectLocalFolderRoot: vi.fn(async () => null),
    })
    const handler = getHandler(channels, 'localFolder:selectRoot')
    const result = await handler({})
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_DIALOG_CANCELED' })
  })

  it('returns path unreachable when selecting root throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      selectLocalFolderRoot: vi.fn(async () => { throw new Error('dialog failed') }),
    })
    const handler = getHandler(channels, 'localFolder:selectRoot')
    const result = await handler({})
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('localFolder:mount', () => {
  beforeEach(() => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/resolved/path' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
  })

  it('success: canonicalizes path, checks duplicate, creates mount, syncs watchers, enqueues full immediate sync', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path', name: 'My Folder' })
    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderNotebookMountSafe).toHaveBeenCalledWith(expect.objectContaining({
      name: 'My Folder',
      root_path: '/some/path',
      status: 'active',
    }))
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
    })
  })

  it('success: post-commit cleanup failures are swallowed after mount commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      syncLocalFolderWatchers: vi.fn(() => { throw new Error('sync failed') }),
      enqueueLocalNotebookIndexSync: vi.fn(() => { throw new Error('enqueue failed') }),
    })
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path', name: 'My Folder' })

    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderNotebookMountSafe).toHaveBeenCalled()
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
    })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('invalid path returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('blank root path returns invalid path', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '   ' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('root path with null byte returns invalid path', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some\0/path' } as any)
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('too long root path returns invalid path', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: `/${'a'.repeat(4097)}` })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('string mount name with null byte returns invalid path', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, {
      root_path: '/some/path',
      name: 'bad\0name',
    } as any)
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('too long mount icon string returns invalid path', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, {
      root_path: '/some/path',
      icon: 'x'.repeat(65),
    } as any)
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('tolerates non-string optional mount fields without throwing', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, {
      root_path: '/some/path',
      name: 123,
      icon: { bad: true },
    } as any)
    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderNotebookMountSafe).toHaveBeenCalledWith(expect.objectContaining({
      name: 'path',
      icon: undefined,
      root_path: '/some/path',
    }))
  })

  it('duplicate lookup failure returns path unreachable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => { throw new Error('db read failed') }),
    })
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path' })

    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    expect(deps.createLocalFolderNotebookMountSafe).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('duplicate mount returns error', async () => {
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => ({ notebook_id: 'nb-existing', status: 'active' as const })),
    })
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path' })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'nb-existing',
        status: 'active',
      },
    })
    expect(deps.getLocalFolderMountByCanonicalPath).toHaveBeenCalledWith('/resolved/path')
  })

  it('duplicate missing-status mount is still blocked', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => ({
        notebook_id: 'nb-missing',
        status: 'missing' as const,
      })),
    })
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path' })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'nb-missing',
        status: 'missing',
      },
    })
  })

  it('path not found returns error', async () => {
    vi.mocked(fsPromises.realpath).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/nonexistent' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_PATH_NOT_FOUND' })
  })

  it('create conflict returns duplicate with existing mount hint', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => ({ notebook_id: 'nb-existing', status: 'active' as const })),
      createLocalFolderNotebookMountSafe: vi.fn(() => ({ status: 'conflict' as const })),
    })
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path' })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'nb-existing',
        status: 'active',
      },
    })
  })

  it('create conflict still returns duplicate error when duplicate lookup fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const getByCanonical = vi.fn()
      .mockReturnValueOnce(null)
      .mockImplementationOnce(() => { throw new Error('lookup failed') })
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: getByCanonical,
      createLocalFolderNotebookMountSafe: vi.fn(() => ({ status: 'conflict' as const })),
    })
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path' })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
    })
    expect(getByCanonical).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })

  it('permission denied returns error', async () => {
    vi.mocked(fsPromises.realpath).mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/protected' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_PATH_PERMISSION_DENIED' })
  })

  it('uses basename when name not provided', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    await handler({}, { root_path: '/some/my-folder' })
    expect(deps.createLocalFolderNotebookMountSafe).toHaveBeenCalledWith(expect.objectContaining({
      name: 'my-folder',
    }))
  })
})

describe('localFolder:relink', () => {
  beforeEach(() => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/new/resolved' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
  })

  it('success: updates root, invalidates cache, stops/re-syncs watchers, enqueues full immediate sync', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new/path' })
    expect(result).toMatchObject({ success: true })
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      root_path: '/new/path',
      status: 'active',
    }))
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1')
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
    })
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalled()
  })

  it('success: post-commit cleanup failures are swallowed after relink commit', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('invalidate failed') }),
      stopLocalFolderWatcher: vi.fn(() => { throw new Error('stop failed') }),
      syncLocalFolderWatchers: vi.fn(() => { throw new Error('sync failed') }),
      enqueueLocalNotebookIndexSync: vi.fn(() => { throw new Error('enqueue failed') }),
      scheduleLocalFolderWatchEvent: vi.fn(() => { throw new Error('event failed') }),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new/path' })

    expect(result).toMatchObject({ success: true })
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1')
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
    })
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('waits for in-flight getTree scan before applying relink root update', async () => {
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    let currentRootPath = '/tmp/test-folder'
    const pendingScanResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingScanResolves.push(resolve)
        })
        return tree
      }),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const getTreeHandler = getHandler(channels, 'localFolder:getTree')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const getTree = getTreeHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(1)

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(0)

    pendingScanResolves[0]?.()
    const [getTreeResult, relinkResult] = await Promise.all([getTree, relink]) as any[]
    expect(getTreeResult).toMatchObject({ success: true, result: tree })
    expect(relinkResult).toMatchObject({ success: true })
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(1)
    expect(currentRootPath).toBe('/tmp/new-root')
  })

  it('waits for in-flight updateNoteMetadata before applying relink root update', async () => {
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let currentRootPath = '/tmp/test-folder'
    const pendingResolvePathResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      resolveLocalFolderFilePathAsync: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingResolvePathResolves.push(resolve)
        })
        return { success: true as const, relative_path: 'resolved.md' }
      }),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const updateNoteMetadataHandler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const update = updateNoteMetadataHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'drafts/a.md',
      is_favorite: true,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.resolveLocalFolderFilePathAsync).toHaveBeenCalledTimes(1)

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(0)

    pendingResolvePathResolves[0]?.()
    const [updateResult, relinkResult] = await Promise.all([update, relink]) as any[]
    expect(updateResult).toMatchObject({ success: true })
    expect(relinkResult).toMatchObject({ success: true })
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(1)
    expect(currentRootPath).toBe('/tmp/new-root')
  })

  it('waits for queued mount before relink duplicate check and keeps existing mount canonical root', async () => {
    let resolveMountCanonical: () => void = () => {}
    let newMountCanonicalCallCount = 0
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-mounted-folder') {
        newMountCanonicalCallCount += 1
        if (newMountCanonicalCallCount === 1) {
          await new Promise<void>((resolve) => {
            resolveMountCanonical = resolve
          })
        }
        return '/tmp/new-mounted-folder' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    const rootByNotebook = new Map<string, string>([['nb-1', '/tmp/test-folder']])
    const mountTimestamp = '2026-01-01T00:00:00.000Z'
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn((notebookId: string) => {
        const root = rootByNotebook.get(notebookId)
        if (!root) return null
        return {
          notebook_id: notebookId,
          root_path: root,
          canonical_root_path: root,
          status: 'active' as const,
          created_at: mountTimestamp,
          updated_at: mountTimestamp,
        }
      }),
      getLocalFolderMountByCanonicalPath: vi.fn((canonicalPath: string, options?: { excludeNotebookId?: string }) => {
        for (const [notebookId, root] of rootByNotebook.entries()) {
          if (options?.excludeNotebookId && notebookId === options.excludeNotebookId) continue
          if (root === canonicalPath) {
            return {
              notebook_id: notebookId,
              root_path: root,
              canonical_root_path: root,
              status: 'active' as const,
              created_at: mountTimestamp,
              updated_at: mountTimestamp,
            }
          }
        }
        return null
      }),
      createLocalFolderNotebookMountSafe: vi.fn((input: {
        name: string
        icon?: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        for (const root of rootByNotebook.values()) {
          if (root === input.canonical_root_path) {
            return { status: 'conflict' as const }
          }
        }
        rootByNotebook.set('nb-2', input.canonical_root_path)
        const mount = createMount({
          notebook: {
            id: 'nb-2',
            name: input.name,
            icon: input.icon || 'logo:notes',
            source_type: 'local-folder',
            order_index: 1,
            created_at: mountTimestamp,
          },
          mount: {
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
          } as any,
        })
        return { status: 'created' as const, mount }
      }),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        if (!rootByNotebook.has(input.notebook_id)) {
          return { status: 'not_found' as const }
        }
        for (const [notebookId, root] of rootByNotebook.entries()) {
          if (notebookId !== input.notebook_id && root === input.canonical_root_path) {
            return { status: 'conflict' as const }
          }
        }
        rootByNotebook.set(input.notebook_id, input.canonical_root_path)
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: mountTimestamp,
            updated_at: mountTimestamp,
          },
        }
      }),
    })
    const mountHandler = getHandler(channels, 'localFolder:mount')
    const relinkHandler = getHandler(channels, 'localFolder:relink')

    const mount = mountHandler({}, {
      root_path: '/tmp/new-mounted-folder',
      name: 'Mounted Folder',
    })
    await Promise.resolve()
    await Promise.resolve()

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-mounted-folder',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledTimes(0)

    resolveMountCanonical()
    const [mountResult, relinkResult] = await Promise.all([mount, relink]) as any[]
    expect(mountResult).toMatchObject({
      success: true,
      result: {
        notebook: { id: 'nb-2' },
      },
    })
    expect(relinkResult).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'nb-2',
      },
    })
    expect(rootByNotebook.get('nb-1')).toBe('/tmp/test-folder')
  })

  it('duplicate returns error', async () => {
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => ({ notebook_id: 'nb-other', status: 'active' as const })),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/dup/path' })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'nb-other',
        status: 'active',
      },
    })
    expect(deps.getLocalFolderMountByCanonicalPath).toHaveBeenCalledWith('/new/resolved', {
      excludeNotebookId: 'nb-1',
    })
  })

  it('current mount lookup failure returns path unreachable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => { throw new Error('db read failed') }),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new/path' })

    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    errorSpy.mockRestore()
  })

  it('duplicate lookup failure returns path unreachable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => { throw new Error('db read failed') }),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new/path' })

    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    errorSpy.mockRestore()
  })

  it('rejects relink when non-active duplicate exists to keep canonical mount unique', async () => {
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => ({ notebook_id: 'nb-other', status: 'missing' as const })),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/dup/path' })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'nb-other',
        status: 'missing',
      },
    })
    expect(deps.getLocalFolderMountByCanonicalPath).toHaveBeenCalledWith('/new/resolved', {
      excludeNotebookId: 'nb-1',
    })
    expect(deps.updateLocalFolderMountRoot).not.toHaveBeenCalled()
  })

  it('not found returns error', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => null),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-999', root_path: '/new/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
  })

  it('root update conflict returns duplicate with existing mount hint', async () => {
    const getByCanonical = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ notebook_id: 'nb-other', status: 'active' as const })
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: getByCanonical,
      updateLocalFolderMountRoot: vi.fn(() => ({ status: 'conflict' as const })),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new/path' })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
      existing_mount: {
        notebook_id: 'nb-other',
        status: 'active',
      },
    })
    expect(getByCanonical).toHaveBeenCalledTimes(2)
  })

  it('root update conflict still returns duplicate error when duplicate lookup fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const getByCanonical = vi.fn()
      .mockReturnValueOnce(null)
      .mockImplementationOnce(() => { throw new Error('lookup failed') })
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: getByCanonical,
      updateLocalFolderMountRoot: vi.fn(() => ({ status: 'conflict' as const })),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new/path' })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
    })
    expect(getByCanonical).toHaveBeenCalledTimes(2)
    errorSpy.mockRestore()
  })

  it('root update throw returns path unreachable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      updateLocalFolderMountRoot: vi.fn(() => {
        throw new Error('write failed')
      }),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    errorSpy.mockRestore()
  })

  it('missing notebook_id returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { root_path: '/new/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
  })

  it('blank notebook_id returns not found and skips mount lookup', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: '   ', root_path: '/new/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
    expect(deps.getLocalFolderMountByNotebookId).not.toHaveBeenCalled()
  })

  it('preserves notebook_id surrounding spaces when relinking', async () => {
    const notebookId = '  nb-1  '
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn((inputNotebookId: string) => (
        inputNotebookId === notebookId ? { root_path: '/tmp/test-folder', status: 'active' as const } : null
      )),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: notebookId, root_path: '/new/path' })
    expect(result).toMatchObject({ success: true })
    expect(deps.getLocalFolderMountByNotebookId).toHaveBeenCalledWith(notebookId)
    expect(deps.updateLocalFolderMountRoot).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: notebookId,
    }))
  })

  it('non-string notebook_id returns not found and skips mount lookup', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 123, root_path: '/new/path' } as any)
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
    expect(deps.getLocalFolderMountByNotebookId).not.toHaveBeenCalled()
  })

  it('invalid root_path returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('blank root_path returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '   ' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('root_path with null byte returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/new\0/path' } as any)
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('too long root_path returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: `/${'a'.repeat(4097)}` })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })
})

describe('localFolder:openInFileManager', () => {
  it('returns not found for invalid notebook id input and skips mount lookup', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:openInFileManager')

    const blankResult = await handler({}, '   ' as any)
    expect(blankResult).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })

    const nonStringResult = await handler({}, 123 as any)
    expect(nonStringResult).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })

    expect(deps.getLocalFolderMountByNotebookId).not.toHaveBeenCalled()
  })

  it('returns true when shell openPath succeeds', async () => {
    const { channels } = setupHandlers({
      openPath: vi.fn(async () => ''),
    })
    const handler = getHandler(channels, 'localFolder:openInFileManager')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: true })
  })

  it('preserves notebook id surrounding spaces when opening folder', async () => {
    const notebookId = '  nb-1  '
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn((inputNotebookId: string) => (
        inputNotebookId === notebookId ? { root_path: '/tmp/test-folder' } : null
      )),
    })
    const handler = getHandler(channels, 'localFolder:openInFileManager')
    const result = await handler({}, notebookId)
    expect(result).toEqual({ success: true })
    expect(deps.getLocalFolderMountByNotebookId).toHaveBeenCalledWith(notebookId)
    expect(deps.openPath).toHaveBeenCalledWith('/tmp/test-folder')
  })

  it('waits for queued relink before opening folder and uses latest root path', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let currentRootPath = '/tmp/test-folder'
    const openCallRoots: string[] = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => ({
        root_path: currentRootPath,
      })),
      openPath: vi.fn(async (path: string) => {
        openCallRoots.push(path)
        return ''
      }),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const relinkHandler = getHandler(channels, 'localFolder:relink')
    const openHandler = getHandler(channels, 'localFolder:openInFileManager')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const openInFileManager = openHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.openPath).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, openResult] = await Promise.all([relink, openInFileManager]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(openResult).toEqual({ success: true })
    expect(openCallRoots).toEqual(['/tmp/new-root'])
  })

  it('returns not found when mount is missing', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => null),
    })
    const handler = getHandler(channels, 'localFolder:openInFileManager')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
  })

  it('returns open failed when shell openPath reports non-empty message', async () => {
    const { channels } = setupHandlers({
      openPath: vi.fn(async () => 'failed to open'),
    })
    const handler = getHandler(channels, 'localFolder:openInFileManager')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_OPEN_FAILED' })
  })

  it('returns path unreachable when mount lookup throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => { throw new Error('mount read failed') }),
    })
    const handler = getHandler(channels, 'localFolder:openInFileManager')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    errorSpy.mockRestore()
  })

  it('returns path unreachable when openPath throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      openPath: vi.fn(async () => { throw new Error('open failed') }),
    })
    const handler = getHandler(channels, 'localFolder:openInFileManager')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    errorSpy.mockRestore()
  })

  it('waits for queued unmount before opening folder and converges to not-found', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      createLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderCreateFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return {
          success: true,
          result: { relative_path: 'queued.md' },
        }
      }),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
      getLocalFolderMountByNotebookId: vi.fn(() => (deleted ? null : ({ root_path: '/tmp/test-folder' } as any))),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')
    const openHandler = getHandler(channels, 'localFolder:openInFileManager')

    const createFile = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const openInFileManager = openHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.openPath).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [createResult, unmountResult, openResult] = await Promise.all([createFile, unmount, openInFileManager]) as any[]
    expect(createResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(openResult).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
    expect(deps.openPath).toHaveBeenCalledTimes(0)
  })
})

describe('localFolder:unmount', () => {
  it('returns not found for invalid notebook id input and skips mount lookup', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:unmount')

    const blankResult = await handler({}, '   ' as any)
    expect(blankResult).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })

    const nonStringResult = await handler({}, 123 as any)
    expect(nonStringResult).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })

    expect(deps.getLocalFolderMountByNotebookId).not.toHaveBeenCalled()
    expect(deps.deleteLocalFolderNotebook).not.toHaveBeenCalled()
  })

  it('waits for in-flight readFile before executing unmount mutation', async () => {
    const pendingReadResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      readLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderReadFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingReadResolves.push(resolve)
        })
        return {
          success: true,
          result: {
            id: 'nb-1:test.md',
            notebook_id: 'nb-1',
            name: 'test.md',
            file_name: 'test.md',
            relative_path: 'test.md',
            extension: 'md',
            tiptap_content: '{}',
            mtime_ms: 1000,
            size: 100,
            content_hash: 'abc123',
          },
        }
      }),
    })
    const readFileHandler = getHandler(channels, 'localFolder:readFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')

    const read = readFileHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    pendingReadResolves[0]?.()
    const [readResult, unmountResult] = await Promise.all([read, unmount]) as any[]
    expect(readResult).toMatchObject({ success: true, result: { relative_path: 'test.md' } })
    expect(unmountResult).toEqual({ success: true })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(1)
  })

  it('preserves notebook id surrounding spaces when unmounting', async () => {
    const notebookId = '  nb-1  '
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, notebookId)
    expect(result).toEqual({ success: true })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledWith(notebookId)
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith(notebookId)
    expect(deps.clearLocalNotebookIndexSyncForNotebook).toHaveBeenCalledWith(notebookId)
    expect(deps.deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith(notebookId)
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith(notebookId)
  })

  it('waits for in-flight analyzeDelete before executing unmount mutation', async () => {
    const pendingDeleteTargetResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      resolveLocalFolderDeleteTargetAsync: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingDeleteTargetResolves.push(resolve)
        })
        return {
          success: true as const,
          result: {
            absolute_path: '/tmp/test-folder/file.md',
            relative_path: 'file.md',
          },
        }
      }),
    })
    const analyzeDeleteHandler = getHandler(channels, 'localFolder:analyzeDelete')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')

    const analyze = analyzeDeleteHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'file.md',
      kind: 'file',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.resolveLocalFolderDeleteTargetAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    pendingDeleteTargetResolves[0]?.()
    const [analyzeResult, unmountResult] = await Promise.all([analyze, unmount]) as any[]
    expect(analyzeResult).toMatchObject({ success: true })
    expect(unmountResult).toEqual({ success: true })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(1)
  })

  it('waits for in-flight openInFileManager before executing unmount mutation', async () => {
    const pendingOpenResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      openPath: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingOpenResolves.push(resolve)
        })
        return ''
      }),
    })
    const openInFileManagerHandler = getHandler(channels, 'localFolder:openInFileManager')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')

    const openInFileManager = openInFileManagerHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.openPath).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    pendingOpenResolves[0]?.()
    const [openResult, unmountResult] = await Promise.all([openInFileManager, unmount]) as any[]
    expect(openResult).toEqual({ success: true })
    expect(unmountResult).toEqual({ success: true })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(1)
  })

  it('success: deletes notebook, stops watcher, clears sync, deletes indexes, invalidates cache, syncs watchers', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: true })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1')
    expect(deps.clearLocalNotebookIndexSyncForNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
  })

  it('success: cleanup failures are swallowed after notebook delete', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      stopLocalFolderWatcher: vi.fn(() => { throw new Error('stop failed') }),
      clearLocalNotebookIndexSyncForNotebook: vi.fn(() => { throw new Error('clear failed') }),
      deleteIndexedLocalNotesByNotebook: vi.fn(() => { throw new Error('index failed') }),
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('cache failed') }),
      syncLocalFolderWatchers: vi.fn(() => { throw new Error('sync failed') }),
    })
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-1')

    expect(result).toEqual({ success: true })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1')
    expect(deps.clearLocalNotebookIndexSyncForNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('does not depend on mount lookup when unmounting', async () => {
    const { channels, deps } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => null),
    })
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-999')
    expect(result).toEqual({ success: true })
    expect(deps.getLocalFolderMountByNotebookId).not.toHaveBeenCalled()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledWith('nb-999')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-999')
  })

  it('skips mount lookup errors because mount lookup is not part of unmount path', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => { throw new Error('mount read failed') }),
    })
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: true })
  })

  it('returns false when notebook delete throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      deleteLocalFolderNotebook: vi.fn(() => { throw new Error('delete failed') }),
    })
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    expect(deps.stopLocalFolderWatcher).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns false when delete rejects non-local notebook', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      deleteLocalFolderNotebook: vi.fn(() => ({ ok: false as const, error: 'notebook_not_local_folder' as const })),
    })
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_LOCAL_FOLDER' })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('converges success when delete reports notebook not found', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      deleteLocalFolderNotebook: vi.fn(() => ({ ok: false as const, error: 'notebook_not_found' as const })),
    })
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: true })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1')
    expect(deps.clearLocalNotebookIndexSyncForNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('localFolder:getTree', () => {
  it('returns path unreachable when loading mounts throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' })
    errorSpy.mockRestore()
  })

  it('success: scans tree, ensures watcher', async () => {
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: true, result: tree })
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalled()
    expect(deps.ensureLocalFolderWatcher).toHaveBeenCalledWith(
      'nb-1',
      '/tmp/test-folder',
      '/tmp/test-folder'
    )
  })

  it('preserves notebook id surrounding spaces when loading tree', async () => {
    const notebookId = '  nb-1  '
    const tree = { notebook_id: notebookId, files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          notebook: {
            id: notebookId,
            name: 'Spaced Notebook',
            icon: 'logo:notes',
            source_type: 'local-folder',
            order_index: 0,
            created_at: '2026-01-01T00:00:00.000Z',
          } as any,
        }),
      ]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, notebookId)
    expect(result).toEqual({ success: true, result: tree })
    expect(deps.ensureLocalFolderWatcher).toHaveBeenCalledWith(
      notebookId,
      '/tmp/test-folder',
      '/tmp/test-folder'
    )
  })

  it('coalesces concurrent getTree requests for same notebook mount snapshot', async () => {
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return tree
      }),
    })
    const handler = getHandler(channels, 'localFolder:getTree')

    const first = handler({}, 'nb-1')
    const second = handler({}, 'nb-1')
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(1)
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: tree },
      { success: true, result: tree },
    ])
    expect(deps.ensureLocalFolderWatcher).toHaveBeenCalledTimes(1)

    const third = handler({}, 'nb-1')
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)
    pendingResolves[1]?.()
    await expect(third).resolves.toEqual({ success: true, result: tree })
    expect(deps.ensureLocalFolderWatcher).toHaveBeenCalledTimes(2)
  })

  it('does not coalesce concurrent getTree requests when mount snapshot key changes', async () => {
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const activeMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'active' } as any,
    })
    const missingMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    let mountReadCount = 0
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => {
        mountReadCount += 1
        return mountReadCount === 1 ? [activeMount] : [missingMount]
      }),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return tree
      }),
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
    })
    const handler = getHandler(channels, 'localFolder:getTree')

    const first = handler({}, 'nb-1')
    const second = handler({}, 'nb-1')
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(2)
    expect(pendingResolves).toHaveLength(2)

    pendingResolves[0]?.()
    pendingResolves[1]?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: tree },
      { success: true, result: tree },
    ])
  })

  it('waits for queued relink before scanning and uses the latest mount root', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let currentRootPath = '/tmp/test-folder'
    const scanCallRoots: string[] = []
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async (mount: LocalFolderNotebookMount) => {
        scanCallRoots.push(mount.mount.root_path)
        return tree
      }),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const relinkHandler = getHandler(channels, 'localFolder:relink')
    const getTreeHandler = getHandler(channels, 'localFolder:getTree')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const getTree = getTreeHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, getTreeResult] = await Promise.all([relink, getTree]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(getTreeResult).toMatchObject({ success: true, result: tree })
    expect(scanCallRoots).toEqual(['/tmp/new-root'])
    expect(deps.ensureLocalFolderWatcher).toHaveBeenCalledWith(
      'nb-1',
      '/tmp/new-root',
      '/tmp/new-root'
    )
  })

  it('waits for queued unmount before loading tree and converges to not-found', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => {
        if (deleted) {
          return []
        }
        return [createMount()]
      }),
      createLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderCreateFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return {
          success: true,
          result: { relative_path: 'queued.md' },
        }
      }),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')
    const getTreeHandler = getHandler(channels, 'localFolder:getTree')

    const createFile = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const getTree = getTreeHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [createResult, unmountResult, getTreeResult] = await Promise.all([createFile, unmount, getTree]) as any[]
    expect(createResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(getTreeResult).toMatchObject({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(1)
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalledTimes(0)
  })

  it('returns not found for blank notebook id without reading mounts', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, '   ')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
    expect(deps.getLocalFolderMounts).not.toHaveBeenCalled()
    expect(deps.scanAndCacheLocalFolderTreeAsync).not.toHaveBeenCalled()
  })

  it('status recovery: inactive -> active triggers sync and watch event', async () => {
    const inactiveMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [inactiveMount]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    await handler({}, 'nb-1')
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'active')
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      full: true,
      immediate: true,
    }))
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'active',
      reason: 'status_changed',
    }))
  })

  it('status recovery: promotion not_found returns notebook not found', async () => {
    const inactiveMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [inactiveMount]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
      updateLocalFolderMountStatus: vi.fn(() => 'not_found' as const),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND',
    })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'active')
    expect(deps.enqueueLocalNotebookIndexSync).not.toHaveBeenCalledWith('nb-1', expect.objectContaining({
      full: true,
      immediate: true,
    }))
    expect(deps.scheduleLocalFolderWatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'active',
      reason: 'status_changed',
    }))
    expect(deps.ensureLocalFolderWatcher).not.toHaveBeenCalledWith(
      'nb-1',
      '/tmp/test-folder',
      '/tmp/test-folder'
    )
  })

  it('status recovery: promotion conflict keeps mount unavailable', async () => {
    const inactiveMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [inactiveMount]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
      updateLocalFolderMountStatus: vi.fn(() => 'conflict' as const),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
      mount_status: 'missing',
    })
    expect(deps.ensureLocalFolderWatcher).not.toHaveBeenCalledWith(
      'nb-1',
      '/tmp/test-folder',
      '/tmp/test-folder'
    )
  })

  it('status recovery: promotion conflict reflects latest persisted unavailable status', async () => {
    const inactiveMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [inactiveMount]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
      updateLocalFolderMountStatus: vi.fn(() => 'conflict' as const),
      getLocalFolderMountByNotebookId: vi.fn(() => ({
        root_path: '/tmp/test-folder',
        status: 'permission_required' as const,
      })),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
      mount_status: 'permission_required',
    })
  })

  it('status recovery: promotion exception keeps mount unavailable', async () => {
    const inactiveMount = createMount({
      mount: { root_path: '/tmp/test-folder', canonical_root_path: '/tmp/test-folder', status: 'missing' } as any,
    })
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [inactiveMount]),
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
      updateLocalFolderMountStatus: vi.fn(() => { throw new Error('status write failed') }),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
      mount_status: 'missing',
    })
    expect(deps.resolveMountStatusFromFsError).not.toHaveBeenCalled()
    expect(deps.ensureLocalFolderWatcher).not.toHaveBeenCalledWith(
      'nb-1',
      '/tmp/test-folder',
      '/tmp/test-folder'
    )
    errorSpy.mockRestore()
  })

  it('scan error: updates status, stops watcher', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => {
        throw Object.assign(new Error('scan failed'), { code: 'ENOENT' })
      }),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
      mount_status: 'missing',
    })
    expect(deps.resolveMountStatusFromFsError).toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      clearPendingEvent: false,
    }))
    errorSpy.mockRestore()
  })

  it('scan error: returns notebook not found when status persistence reports row missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => {
        throw Object.assign(new Error('scan failed'), { code: 'ENOENT' })
      }),
      updateLocalFolderMountStatus: vi.fn(() => 'not_found' as const),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND',
    })
    expect(deps.updateLocalFolderMountStatus).toHaveBeenCalled()
    expect(deps.scheduleLocalFolderWatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'status_changed',
    }))
    expect(deps.enqueueLocalNotebookIndexSync).not.toHaveBeenCalledWith('nb-1', expect.objectContaining({
      full: true,
      immediate: true,
    }))
    errorSpy.mockRestore()
  })

  it('scan error: swallows status persistence exception and returns mount unavailable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => {
        throw Object.assign(new Error('scan failed'), { code: 'ENOENT' })
      }),
      updateLocalFolderMountStatus: vi.fn(() => { throw new Error('db unavailable') }),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
      mount_status: 'missing',
    })
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      clearPendingEvent: false,
    }))
    expect(deps.scheduleLocalFolderWatchEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'status_changed',
    }))
    errorSpy.mockRestore()
  })

  it('scan error: non-fs failure does not downgrade mount status', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => { throw new Error('scan parser failed') }),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({
      success: false,
      errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE',
    })
    expect(deps.resolveMountStatusFromFsError).not.toHaveBeenCalled()
    expect(deps.updateLocalFolderMountStatus).not.toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).not.toHaveBeenCalled()
    expect(deps.stopLocalFolderWatcher).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns not found when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toEqual({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
  })
})

describe('localFolder:listNoteMetadata', () => {
  it('returns metadata list', async () => {
    const items = [{ notebook_id: 'nb-1', relative_path: 'a.md' }]
    const { channels } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => items),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = await handler({}, { notebook_ids: ['nb-1'] }) as any
    expect(result).toMatchObject({ success: true, result: { items } })
  })

  it('preserves notebook_ids surrounding spaces when listing metadata', async () => {
    const notebookId = '  nb-1  '
    const items = [{ notebook_id: notebookId, relative_path: 'a.md' }]
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => items),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = await handler({}, { notebook_ids: [notebookId, '   ', 123] } as any) as any
    expect(result).toMatchObject({ success: true, result: { items } })
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledWith({ notebookIds: [notebookId] })
  })

  it('returns empty list when explicit notebook_ids filter has no valid notebook ids', async () => {
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => [{ notebook_id: 'nb-1', relative_path: 'a.md' }]),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = await handler({}, { notebook_ids: ['   ', 123 as any] } as any) as any
    expect(result).toMatchObject({ success: true, result: { items: [] } })
    expect(deps.listLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('returns empty list when notebook_ids field is explicitly non-array', async () => {
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => [{ notebook_id: 'nb-1', relative_path: 'a.md' }]),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = await handler({}, { notebook_ids: 'nb-1' as any } as any) as any
    expect(result).toMatchObject({ success: true, result: { items: [] } })
    expect(deps.listLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('returns empty list when notebook_ids filter exceeds max size', async () => {
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => [{ notebook_id: 'nb-1', relative_path: 'a.md' }]),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const oversizedNotebookIds = Array.from({ length: 2001 }, (_, index) => `nb-${index}`)
    const result = await handler({}, { notebook_ids: oversizedNotebookIds } as any) as any
    expect(result).toMatchObject({ success: true, result: { items: [] } })
    expect(deps.listLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('returns empty list when listNoteMetadata payload shape is invalid', async () => {
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => [{ notebook_id: 'nb-1', relative_path: 'a.md' }]),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')

    const invalidStringResult = await handler({}, 'nb-1' as any) as any
    expect(invalidStringResult).toMatchObject({ success: true, result: { items: [] } })

    const invalidArrayResult = await handler({}, ['nb-1'] as any) as any
    expect(invalidArrayResult).toMatchObject({ success: true, result: { items: [] } })

    const invalidNullResult = await handler({}, null as any) as any
    expect(invalidNullResult).toMatchObject({ success: true, result: { items: [] } })

    expect(deps.listLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('treats explicit undefined notebook_ids as omitted (global list)', async () => {
    const items = [{ notebook_id: 'nb-1', relative_path: 'a.md' }]
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => items),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = await handler({}, { notebook_ids: undefined } as any) as any
    expect(result).toMatchObject({ success: true, result: { items } })
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledWith({ notebookIds: undefined })
  })

  it('waits for queued relink before listing metadata for notebook', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    const items = [{ notebook_id: 'nb-1', relative_path: 'a.md' }]
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => items),
    })
    const relinkHandler = getHandler(channels, 'localFolder:relink')
    const listHandler = getHandler(channels, 'localFolder:listNoteMetadata')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const list = listHandler({}, { notebook_ids: ['nb-1'] })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, listResult] = await Promise.all([relink, list]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(listResult).toMatchObject({ success: true, result: { items } })
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledWith({ notebookIds: ['nb-1'] })
  })

  it('waits for queued unmount before listing metadata for notebook', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const itemsBeforeUnmount = [{ notebook_id: 'nb-1', relative_path: 'a.md' }]
    const itemsAfterUnmount: Array<{ notebook_id: string, relative_path: string }> = []
    const { channels, deps } = setupHandlers({
      createLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderCreateFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return {
          success: true,
          result: { relative_path: 'queued.md' },
        }
      }),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
      listLocalNoteMetadata: vi.fn(() => (deleted ? itemsAfterUnmount : itemsBeforeUnmount)),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')
    const listHandler = getHandler(channels, 'localFolder:listNoteMetadata')

    const createFile = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const list = listHandler({}, { notebook_ids: ['nb-1'] })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [createResult, unmountResult, listResult] = await Promise.all([createFile, unmount, list]) as any[]
    expect(createResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(listResult).toMatchObject({ success: true, result: { items: itemsAfterUnmount } })
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledWith({ notebookIds: ['nb-1'] })
  })

  it('waits for queued relink before listing metadata without notebook filter', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    const items = [{ notebook_id: 'nb-1', relative_path: 'a.md' }]
    const { channels, deps } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => items),
    })
    const relinkHandler = getHandler(channels, 'localFolder:relink')
    const listHandler = getHandler(channels, 'localFolder:listNoteMetadata')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const list = listHandler({}, undefined as any)
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, listResult] = await Promise.all([relink, list]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(listResult).toMatchObject({ success: true, result: { items } })
    expect(deps.listLocalNoteMetadata).toHaveBeenCalledWith({ notebookIds: undefined })
  })

  it('handles errors gracefully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => { throw new Error('db error') }),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = await handler({}) as any
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    errorSpy.mockRestore()
  })
})

describe('localFolder:updateNoteMetadata', () => {
  it('success path', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.updateLocalNoteMetadata).toHaveBeenCalled()
  })

  it('normalizes valid summary_content_hash to lowercase before writing metadata', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      summary_content_hash: 'ABCDEF0123456789ABCDEF0123456789',
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.updateLocalNoteMetadata).toHaveBeenCalledWith(expect.objectContaining({
      summary_content_hash: 'abcdef0123456789abcdef0123456789',
    }))
  })

  it('returns typed not-found error for null payload', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, null as any)
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('preserves notebook_id surrounding spaces when updating metadata', async () => {
    const notebookId = '  nb-1  '
    const mountWithSpacedNotebookId = createMount({
      notebook: {
        id: notebookId,
        name: 'Spaced Notebook',
        icon: 'logo:notes',
        source_type: 'local-folder',
        order_index: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      } as any,
    })
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [mountWithSpacedNotebookId]),
      resolveLocalFolderFilePathAsync: vi.fn(async (_mount: LocalFolderNotebookMount, relativePath: string) => ({
        success: true as const,
        relative_path: relativePath,
      })),
    })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: notebookId,
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: true })
    expect(deps.updateLocalNoteMetadata).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: notebookId,
    }))
  })

  it('preserves relative_path surrounding spaces when updating metadata', async () => {
    const { channels, deps } = setupHandlers({
      resolveLocalFolderFilePathAsync: vi.fn(async (_mount: LocalFolderNotebookMount, relativePath: string) => ({
        success: true as const,
        relative_path: relativePath,
      })),
    })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const relativePath = '  docs/test.md  '

    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: relativePath,
      is_favorite: true,
    }) as any

    expect(result).toMatchObject({ success: true })
    expect(deps.resolveLocalFolderFilePathAsync).toHaveBeenCalledWith(expect.anything(), relativePath)
  })

  it('waits for queued relink before resolving metadata path and uses latest mount root', async () => {
    let resolveRelinkCanonical: () => void = () => {}
    vi.mocked(fsPromises.realpath).mockImplementation(async (pathInput: any) => {
      if (pathInput === '/tmp/new-root') {
        await new Promise<void>((resolve) => {
          resolveRelinkCanonical = resolve
        })
        return '/tmp/new-root' as any
      }
      return '/tmp/test-folder' as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)

    let currentRootPath = '/tmp/test-folder'
    const resolvedRoots: string[] = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => [
        createMount({
          mount: {
            root_path: currentRootPath,
            canonical_root_path: currentRootPath,
            status: 'active',
          } as any,
        }),
      ]),
      resolveLocalFolderFilePathAsync: vi.fn(async (mount: LocalFolderNotebookMount, relativePath: string) => {
        resolvedRoots.push(mount.mount.root_path)
        return {
          success: true as const,
          relative_path: relativePath,
        }
      }),
      updateLocalFolderMountRoot: vi.fn((input: {
        notebook_id: string
        root_path: string
        canonical_root_path: string
        status?: 'active' | 'missing' | 'permission_required'
      }) => {
        currentRootPath = input.root_path
        return {
          status: 'updated' as const,
          mount: {
            notebook_id: input.notebook_id,
            root_path: input.root_path,
            canonical_root_path: input.canonical_root_path,
            status: input.status ?? 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        }
      }),
    })
    const relinkHandler = getHandler(channels, 'localFolder:relink')
    const updateMetadataHandler = getHandler(channels, 'localFolder:updateNoteMetadata')

    const relink = relinkHandler({}, {
      notebook_id: 'nb-1',
      root_path: '/tmp/new-root',
    })
    await Promise.resolve()
    await Promise.resolve()

    const updateMetadata = updateMetadataHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.resolveLocalFolderFilePathAsync).toHaveBeenCalledTimes(0)

    resolveRelinkCanonical()
    const [relinkResult, updateResult] = await Promise.all([relink, updateMetadata]) as any[]
    expect(relinkResult).toMatchObject({ success: true })
    expect(updateResult).toMatchObject({ success: true })
    expect(resolvedRoots).toEqual(['/tmp/new-root'])
  })

  it('validation: missing fields returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      // no update fields
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
  })

  it('validation: invalid metadata field types return error', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')

    const invalidBooleanResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: 'yes',
    } as any)
    expect(invalidBooleanResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })

    const invalidStringResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      ai_summary: 123,
    } as any)
    expect(invalidStringResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })

    const oversizedSummaryResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      ai_summary: 'x'.repeat(16 * 1024 + 1),
    } as any)
    expect(oversizedSummaryResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })

    const invalidTagsResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tags: ['ok', 1],
    } as any)
    expect(invalidTagsResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })

    const oversizedTagsResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      tags: Array.from({ length: 257 }, (_, index) => `tag-${index}`),
    } as any)
    expect(oversizedTagsResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })

    const invalidSummaryHashFormatResult = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      summary_content_hash: 'not-a-valid-summary-hash',
    } as any)
    expect(invalidSummaryHashFormatResult).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    expect(deps.updateLocalNoteMetadata).not.toHaveBeenCalled()
  })

  it('missing notebook_id returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: '',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })

  it('oversized relative_path returns not-found error', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'x'.repeat(4097),
      is_favorite: true,
    } as any)
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
    expect(deps.resolveLocalFolderFilePathAsync).not.toHaveBeenCalled()
  })

  it('mount not found returns error', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
  })

  it('waits for queued unmount before updating metadata and converges to not-found', async () => {
    let deleted = false
    const pendingResolves: Array<() => void> = []
    const { channels, deps } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => {
        if (deleted) return []
        return [createMount()]
      }),
      createLocalFolderFileAsync: vi.fn(async (): Promise<LocalFolderCreateFileResponse> => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return {
          success: true,
          result: { relative_path: 'queued.md' },
        }
      }),
      deleteLocalFolderNotebook: vi.fn(() => {
        deleted = true
        return { ok: true as const }
      }),
    })
    const createFileHandler = getHandler(channels, 'localFolder:createFile')
    const unmountHandler = getHandler(channels, 'localFolder:unmount')
    const updateMetadataHandler = getHandler(channels, 'localFolder:updateNoteMetadata')

    const createFile = createFileHandler({}, {
      notebook_id: 'nb-1',
      parent_relative_path: null,
      file_name: 'queued.md',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.createLocalFolderFileAsync).toHaveBeenCalledTimes(1)

    const unmount = unmountHandler({}, 'nb-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.deleteLocalFolderNotebook).toHaveBeenCalledTimes(0)

    const updateMetadata = updateMetadataHandler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.resolveLocalFolderFilePathAsync).toHaveBeenCalledTimes(0)
    expect(deps.updateLocalNoteMetadata).toHaveBeenCalledTimes(0)

    pendingResolves[0]?.()
    const [createResult, unmountResult, updateResult] = await Promise.all([createFile, unmount, updateMetadata]) as any[]
    expect(createResult).toMatchObject({ success: true })
    expect(unmountResult).toMatchObject({ success: true })
    expect(updateResult).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(deps.resolveLocalFolderFilePathAsync).toHaveBeenCalledTimes(0)
    expect(deps.updateLocalNoteMetadata).toHaveBeenCalledTimes(0)
  })

  it('mount lookup failure returns unreadable error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      getLocalFolderMounts: vi.fn(() => { throw new Error('mount list failed') }),
    })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    errorSpy.mockRestore()
  })

  it('path resolution failure returns unreadable error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      resolveLocalFolderFilePathAsync: vi.fn(async () => { throw new Error('resolve failed') }),
    })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    errorSpy.mockRestore()
  })

  it('metadata write exception returns write failed error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      updateLocalNoteMetadata: vi.fn(() => { throw new Error('write failed') }),
    })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' })
    errorSpy.mockRestore()
  })

  it('missing mount status returns error', async () => {
    const missingMount = createMount({
      mount: { root_path: '/tmp/test', canonical_root_path: '/tmp/test', status: 'missing' } as any,
    })
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => [missingMount]) })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
  })

  it('permission_required mount status returns error', async () => {
    const permMount = createMount({
      mount: { root_path: '/tmp/test', canonical_root_path: '/tmp/test', status: 'permission_required' } as any,
    })
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => [permMount]) })
    const handler = getHandler(channels, 'localFolder:updateNoteMetadata')
    const result = await handler({}, {
      notebook_id: 'nb-1',
      relative_path: 'test.md',
      is_favorite: true,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
  })
})
