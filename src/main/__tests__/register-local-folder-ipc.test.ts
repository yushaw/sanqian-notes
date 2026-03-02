import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  LocalFolderNotebookMount,
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
vi.mock('path', () => ({
  resolve: vi.fn((p: string) => p),
  basename: vi.fn((p: string) => p.split('/').pop() || p),
  sep: '/',
}))
vi.mock('../path-compat', () => ({
  normalizeComparablePathForFileSystem: vi.fn((_base: string, p: string) => p),
}))

import { promises as fsPromises } from 'fs'

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
  return {
    getLocalFolderMounts: vi.fn(() => [createMount()]),
    getLocalFolderMountByCanonicalPath: vi.fn(() => null),
    getLocalFolderMountByNotebookId: vi.fn(() => ({ root_path: '/tmp/test-folder' })),
    createLocalFolderNotebookMount: vi.fn(() => createMount()),
    updateLocalFolderMountRoot: vi.fn(() => ({})),
    updateLocalFolderMountStatus: vi.fn(),
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
    trashItem: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    deleteNotebook: vi.fn(() => true),
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
  it('returns mounts list', () => {
    const mounts = [createMount()]
    const { channels, deps } = setupHandlers({ getLocalFolderMounts: vi.fn(() => mounts) })
    const handler = getHandler(channels, 'localFolder:list')
    handler({})
    expect(deps.getLocalFolderMounts).toHaveBeenCalled()
  })
})

describe('localFolder:readFile', () => {
  it('returns file with etag on success', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(deps.readLocalFolderFileAsync).toHaveBeenCalled()
    expect(deps.buildLocalEtag).toHaveBeenCalled()
    expect(result).toMatchObject({ success: true })
  })

  it('returns error when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:readFile')
    const result = await handler({}, { notebook_id: 'nb-1', relative_path: 'test.md' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' })
  })
})

describe('localFolder:saveFile', () => {
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
})

describe('localFolder:createFile', () => {
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
})

describe('localFolder:renameEntry', () => {
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
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      full: true,
      immediate: true,
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
})

describe('localFolder:deleteEntry', () => {
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
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      full: true,
      immediate: true,
    }))
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

describe('localFolder:mount', () => {
  beforeEach(() => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/resolved/path' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
  })

  it('success: canonicalizes path, checks duplicate, creates mount, syncs watchers, enqueues full sync', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path', name: 'My Folder' })
    expect(result).toMatchObject({ success: true })
    expect(deps.createLocalFolderNotebookMount).toHaveBeenCalledWith(expect.objectContaining({
      name: 'My Folder',
      root_path: '/some/path',
      status: 'active',
    }))
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      full: true,
      immediate: true,
    }))
  })

  it('invalid path returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })

  it('duplicate mount returns error', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => ({ notebook_id: 'nb-existing' })),
    })
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/some/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS' })
  })

  it('path not found returns error', async () => {
    vi.mocked(fsPromises.realpath).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:mount')
    const result = await handler({}, { root_path: '/nonexistent' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_PATH_NOT_FOUND' })
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
    expect(deps.createLocalFolderNotebookMount).toHaveBeenCalledWith(expect.objectContaining({
      name: 'my-folder',
    }))
  })
})

describe('localFolder:relink', () => {
  beforeEach(() => {
    vi.mocked(fsPromises.realpath).mockResolvedValue('/new/resolved' as any)
    vi.mocked(fsPromises.stat).mockResolvedValue({ isDirectory: () => true } as any)
  })

  it('success: updates root, invalidates cache, stops/re-syncs watchers, enqueues full sync', async () => {
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
    expect(deps.enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      full: true,
      immediate: true,
    }))
    expect(deps.scheduleLocalFolderWatchEvent).toHaveBeenCalled()
  })

  it('duplicate returns error', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByCanonicalPath: vi.fn(() => ({ notebook_id: 'nb-other' })),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '/dup/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS' })
  })

  it('not found returns error', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => null),
    })
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-999', root_path: '/new/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
  })

  it('missing notebook_id returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { root_path: '/new/path' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' })
  })

  it('invalid root_path returns error', async () => {
    const { channels } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:relink')
    const result = await handler({}, { notebook_id: 'nb-1', root_path: '' })
    expect(result).toMatchObject({ success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' })
  })
})

describe('localFolder:unmount', () => {
  it('success: deletes notebook, clears sync, deletes indexes, invalidates cache, syncs watchers', async () => {
    const { channels, deps } = setupHandlers()
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-1')
    expect(result).toBe(true)
    expect(deps.deleteNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.clearLocalNotebookIndexSyncForNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.deleteIndexedLocalNotesByNotebook).toHaveBeenCalledWith('nb-1')
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.syncLocalFolderWatchers).toHaveBeenCalled()
  })

  it('not found returns false', async () => {
    const { channels } = setupHandlers({
      getLocalFolderMountByNotebookId: vi.fn(() => null),
    })
    const handler = getHandler(channels, 'localFolder:unmount')
    const result = await handler({}, 'nb-999')
    expect(result).toBe(false)
  })
})

describe('localFolder:getTree', () => {
  it('success: scans tree, ensures watcher', async () => {
    const tree = { notebook_id: 'nb-1', files: [], folders: [] } as unknown as LocalFolderTreeResult
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => tree),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toBe(tree)
    expect(deps.scanAndCacheLocalFolderTreeAsync).toHaveBeenCalled()
    expect(deps.ensureLocalFolderWatcher).toHaveBeenCalledWith('nb-1', '/tmp/test-folder')
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

  it('scan error: updates status, stops watcher', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, deps } = setupHandlers({
      scanAndCacheLocalFolderTreeAsync: vi.fn(async () => { throw new Error('scan failed') }),
    })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toBeNull()
    expect(deps.resolveMountStatusFromFsError).toHaveBeenCalled()
    expect(deps.invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(deps.stopLocalFolderWatcher).toHaveBeenCalledWith('nb-1', expect.objectContaining({
      clearPendingEvent: false,
    }))
    errorSpy.mockRestore()
  })

  it('returns null when mount not found', async () => {
    const { channels } = setupHandlers({ getLocalFolderMounts: vi.fn(() => []) })
    const handler = getHandler(channels, 'localFolder:getTree')
    const result = await handler({}, 'nb-1')
    expect(result).toBeNull()
  })
})

describe('localFolder:listNoteMetadata', () => {
  it('returns metadata list', () => {
    const items = [{ notebook_id: 'nb-1', relative_path: 'a.md' }]
    const { channels } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => items),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = handler({}, { notebook_ids: ['nb-1'] }) as any
    expect(result).toMatchObject({ success: true, result: { items } })
  })

  it('handles errors gracefully', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels } = setupHandlers({
      listLocalNoteMetadata: vi.fn(() => { throw new Error('db error') }),
    })
    const handler = getHandler(channels, 'localFolder:listNoteMetadata')
    const result = handler({}) as any
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
