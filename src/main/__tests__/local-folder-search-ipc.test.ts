import { describe, expect, it, vi } from 'vitest'
import type {
  LocalFolderNotebookMount,
  LocalFolderSearchHit,
  LocalFolderTreeResult,
  NotebookStatus,
} from '../../shared/types'
import { createLocalFolderSearchHandler } from '../local-folder-search-ipc'

function createMount(
  id: string,
  status: NotebookStatus = 'active',
  options?: { rootPath?: string; canonicalRootPath?: string }
): LocalFolderNotebookMount {
  const now = '2026-02-26T00:00:00.000Z'
  const rootPath = options?.rootPath || `/tmp/${id}`
  const canonicalRootPath = options?.canonicalRootPath || rootPath
  return {
    notebook: {
      id,
      name: `Notebook ${id}`,
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: id,
      root_path: rootPath,
      canonical_root_path: canonicalRootPath,
      status,
      created_at: now,
      updated_at: now,
    },
  }
}

function createHit(notebookId: string, relativePath: string): LocalFolderSearchHit {
  return {
    notebook_id: notebookId,
    relative_path: relativePath,
    canonical_path: `/tmp/${notebookId}/${relativePath}`,
    score: 1,
    mtime_ms: 1,
    snippet: 'match',
  }
}

describe('local-folder-search-ipc', () => {
  it('limits global search concurrency while preserving all mount hits', async () => {
    const mounts = [createMount('nb-1'), createMount('nb-2'), createMount('nb-3')]
    const updateStatus = vi.fn(() => 'updated' as const)
    const invalidateCache = vi.fn()
    const scheduleWatch = vi.fn()

    let active = 0
    let maxActive = 0
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => mounts,
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: invalidateCache,
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      dedupeHits: (hits) => hits,
      searchLocalFolderMount: async (mount) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return [createHit(mount.notebook.id, 'note.md')]
      },
    })

    const response = await handler({ query: 'alpha' })
    expect(response.success).toBe(true)
    if (!response.success) return

    expect(maxActive).toBe(2)
    expect(response.result.hits).toHaveLength(3)
    expect(updateStatus).not.toHaveBeenCalled()
    expect(invalidateCache).not.toHaveBeenCalled()
    expect(scheduleWatch).not.toHaveBeenCalled()
  })

  it('coalesces concurrent global searches for the same normalized query key', async () => {
    const mount = createMount('nb-1')
    const pendingResolves: Array<() => void> = []
    const searchLocalFolderMount = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        pendingResolves.push(resolve)
      })
      return [createHit('nb-1', 'docs/plan.md')]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const first = handler({ query: '  Alpha   Beta ' })
    const second = handler({ query: 'alpha beta' })
    await vi.waitFor(() => {
      expect(searchLocalFolderMount).toHaveBeenCalledTimes(1)
    })
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: { hits: [createHit('nb-1', 'docs/plan.md')] } },
      { success: true, result: { hits: [createHit('nb-1', 'docs/plan.md')] } },
    ])

    const third = handler({ query: 'alpha beta' })
    await vi.waitFor(() => {
      expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    })
    expect(pendingResolves).toHaveLength(2)
    pendingResolves[1]?.()
    await expect(third).resolves.toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
  })

  it('returns empty hits when query is non-string and does not execute mount search', async () => {
    const mount = createMount('nb-1')
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({ query: { value: 'alpha' } } as any)
    expect(response).toEqual({
      success: true,
      result: { hits: [] },
    })
    expect(searchLocalFolderMount).not.toHaveBeenCalled()
  })

  it('returns empty hits when query contains null byte or exceeds max length', async () => {
    const mount = createMount('nb-1')
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const nullByteResponse = await handler({ query: 'alpha\0beta' })
    expect(nullByteResponse).toEqual({
      success: true,
      result: { hits: [] },
    })

    const tooLongResponse = await handler({ query: 'x'.repeat(10_001) })
    expect(tooLongResponse).toEqual({
      success: true,
      result: { hits: [] },
    })
    expect(searchLocalFolderMount).not.toHaveBeenCalled()
  })

  it('does not broaden to global search when notebook_id is explicit but blank', async () => {
    const mount = createMount('nb-1')
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: '',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(searchLocalFolderMount).not.toHaveBeenCalled()
  })

  it('does not broaden to global search when notebook_id is explicit but non-string', async () => {
    const mount = createMount('nb-1')
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 123 as unknown as string,
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(searchLocalFolderMount).not.toHaveBeenCalled()
  })

  it('does not broaden to notebook search when folder_relative_path is explicit but non-string', async () => {
    const mount = createMount('nb-1')
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 123 as unknown as string,
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(searchLocalFolderMount).not.toHaveBeenCalled()
  })

  it('fails closed when folder_relative_path contains null byte or exceeds max length', async () => {
    const mount = createMount('nb-1')
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const nullByteResponse = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs\0drafts',
    })
    expect(nullByteResponse).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })

    const tooLongResponse = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'x'.repeat(4097),
    })
    expect(tooLongResponse).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(searchLocalFolderMount).not.toHaveBeenCalled()
  })

  it('treats explicit undefined notebook_id as omitted (global search)', async () => {
    const mount = createMount('nb-1')
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: undefined as any,
    })

    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(searchLocalFolderMount).toHaveBeenCalledTimes(1)
    expect(searchLocalFolderMount).toHaveBeenCalledWith(
      expect.any(Object),
      'alpha',
      null,
      undefined
    )
  })

  it('does not coalesce scoped searches when folder scope differs', async () => {
    const mount = createMount('nb-1')
    const pendingResolvesByFolder = new Map<string | null, () => void>()
    const searchLocalFolderMount = vi.fn(
      async (_mount: LocalFolderNotebookMount, _query: string, folderRelativePath: string | null) => {
        await new Promise<void>((resolve) => {
          pendingResolvesByFolder.set(folderRelativePath, resolve)
        })
        return [createHit('nb-1', `${folderRelativePath ?? 'root'}/plan.md`)]
      }
    )

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const docsTask = handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    const draftsTask = handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'drafts',
    })
    await vi.waitFor(() => {
      expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    })
    expect(pendingResolvesByFolder.size).toBe(2)

    pendingResolvesByFolder.get('docs')?.()
    pendingResolvesByFolder.get('drafts')?.()
    await expect(Promise.all([docsTask, draftsTask])).resolves.toEqual([
      { success: true, result: { hits: [createHit('nb-1', 'docs/plan.md')] } },
      { success: true, result: { hits: [createHit('nb-1', 'drafts/plan.md')] } },
    ])
  })

  it('coalesces scoped searches when folder scope paths are aliases of the same folder', async () => {
    const mount = createMount('nb-1')
    const pendingResolves: Array<() => void> = []
    const searchLocalFolderMount = vi.fn(
      async (_mount: LocalFolderNotebookMount, _query: string, folderRelativePath: string | null) => {
        await new Promise<void>((resolve) => {
          pendingResolves.push(resolve)
        })
        return [createHit('nb-1', `${folderRelativePath ?? 'root'}/plan.md`)]
      }
    )

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const first = handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: './docs/',
    })
    const second = handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    await vi.waitFor(() => {
      expect(searchLocalFolderMount).toHaveBeenCalledTimes(1)
    })
    expect(pendingResolves).toHaveLength(1)

    pendingResolves[0]?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: { hits: [createHit('nb-1', 'docs/plan.md')] } },
      { success: true, result: { hits: [createHit('nb-1', 'docs/plan.md')] } },
    ])
  })

  it('does not coalesce scoped searches for trim-only folder path aliases', async () => {
    const mount = createMount('nb-1')
    const pendingResolvesByFolder = new Map<string | null, () => void>()
    const searchLocalFolderMount = vi.fn(
      async (_mount: LocalFolderNotebookMount, _query: string, folderRelativePath: string | null) => {
        await new Promise<void>((resolve) => {
          pendingResolvesByFolder.set(folderRelativePath, resolve)
        })
        return [createHit('nb-1', `${folderRelativePath ?? 'root'}/plan.md`)]
      }
    )

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const first = handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: ' docs',
    })
    const second = handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    await vi.waitFor(() => {
      expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    })
    expect(pendingResolvesByFolder.size).toBe(2)

    pendingResolvesByFolder.get(' docs')?.()
    pendingResolvesByFolder.get('docs')?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: { hits: [createHit('nb-1', ' docs/plan.md')] } },
      { success: true, result: { hits: [createHit('nb-1', 'docs/plan.md')] } },
    ])
  })

  it('does not coalesce scoped searches when folder/query delimiters could collide in legacy key format', async () => {
    const mount = createMount('nb-1')
    const pendingResolvesByScope = new Map<string, () => void>()
    const searchLocalFolderMount = vi.fn(
      async (
        _mount: LocalFolderNotebookMount,
        query: string,
        folderRelativePath: string | null
      ) => {
        const scopeKey = `${folderRelativePath ?? 'root'}|${query}`
        await new Promise<void>((resolve) => {
          pendingResolvesByScope.set(scopeKey, resolve)
        })
        return [createHit('nb-1', `${folderRelativePath ?? 'root'}/${query}.md`)]
      }
    )

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const first = handler({
      query: 'a::b',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    const second = handler({
      query: 'b',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs::a',
    })
    await vi.waitFor(() => {
      expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    })
    expect(pendingResolvesByScope.size).toBe(2)

    pendingResolvesByScope.get('docs|a::b')?.()
    pendingResolvesByScope.get('docs::a|b')?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { success: true, result: { hits: [createHit('nb-1', 'docs/a::b.md')] } },
      { success: true, result: { hits: [createHit('nb-1', 'docs::a/b.md')] } },
    ])
  })

  it('waits for local-folder mutation tails before scoped search execution', async () => {
    const mount = createMount('nb-1')
    const pendingMutationResolves: Array<() => void> = []
    const waitForLocalFolderMutationTails = vi.fn(() =>
      new Promise<void>((resolve) => {
        pendingMutationResolves.push(resolve)
      })
    )
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      waitForLocalFolderMutationTails,
      searchLocalFolderMount,
    })

    const task = handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(waitForLocalFolderMutationTails).toHaveBeenCalledWith(['nb-1'])
    expect(searchLocalFolderMount).toHaveBeenCalledTimes(0)

    pendingMutationResolves[0]?.()
    await expect(task).resolves.toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(searchLocalFolderMount).toHaveBeenCalledTimes(1)
  })

  it('does not pass cached tree to scoped search when cached root mismatches mount root', async () => {
    const mount = createMount('nb-1')
    mount.mount.root_path = '/tmp/new-root'
    mount.mount.canonical_root_path = '/tmp/new-root'
    const staleTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/old-root',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    } as LocalFolderTreeResult

    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])
    const invalidateLocalFolderTreeCache = vi.fn()
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => staleTree,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache,
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(searchLocalFolderMount).toHaveBeenCalledTimes(1)
    expect(searchLocalFolderMount).toHaveBeenCalledWith(
      mount,
      'alpha',
      'docs',
      undefined
    )
    expect(invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
  })

  it('swallows stale cache invalidation exception when cached root mismatches mount root', async () => {
    const mount = createMount('nb-1')
    mount.mount.root_path = '/tmp/new-root'
    mount.mount.canonical_root_path = '/tmp/new-root'
    const staleTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/old-root',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    } as LocalFolderTreeResult
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => staleTree,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(() => {
        throw new Error('cache unavailable')
      }),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(searchLocalFolderMount).toHaveBeenCalledWith(
      mount,
      'alpha',
      'docs',
      undefined
    )
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('passes cached tree to scoped search when cached root matches mount root', async () => {
    const mount = createMount('nb-1')
    const cachedTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/nb-1',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    } as LocalFolderTreeResult

    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => cachedTree,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(searchLocalFolderMount).toHaveBeenCalledTimes(1)
    expect(searchLocalFolderMount).toHaveBeenCalledWith(
      mount,
      'alpha',
      'docs',
      cachedTree
    )
  })

  it('passes cached tree to scoped search when cached root normalizes to mount canonical root', async () => {
    const mount = createMount('nb-1', 'active', {
      rootPath: '/tmp/project/notes',
      canonicalRootPath: '/tmp/project/notes',
    })
    const cachedTree = {
      notebook_id: 'nb-1',
      root_path: '/tmp/project/notes/../notes',
      scanned_at: '2026-01-01T00:00:00.000Z',
      tree: [],
      files: [],
    } as LocalFolderTreeResult
    const invalidateLocalFolderTreeCache = vi.fn()

    const searchLocalFolderMount = vi.fn(async () => [createHit('nb-1', 'docs/plan.md')])
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => cachedTree,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache,
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(searchLocalFolderMount).toHaveBeenCalledWith(
      mount,
      'alpha',
      'docs',
      cachedTree
    )
    expect(invalidateLocalFolderTreeCache).not.toHaveBeenCalled()
  })

  it('waits for global local-folder mutation tails before global search execution', async () => {
    const mounts = [createMount('nb-1'), createMount('nb-2')]
    const pendingMutationResolves: Array<() => void> = []
    const waitForLocalFolderMutationTails = vi.fn(() =>
      new Promise<void>((resolve) => {
        pendingMutationResolves.push(resolve)
      })
    )
    const searchLocalFolderMount = vi.fn(async (mount: LocalFolderNotebookMount) => [
      createHit(mount.notebook.id, 'docs/plan.md'),
    ])

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => mounts,
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      waitForLocalFolderMutationTails,
      searchLocalFolderMount,
    })

    const task = handler({ query: 'alpha' })
    await Promise.resolve()
    await Promise.resolve()
    expect(waitForLocalFolderMutationTails).toHaveBeenCalledWith(undefined)
    expect(searchLocalFolderMount).toHaveBeenCalledTimes(0)

    pendingMutationResolves[0]?.()
    await expect(task).resolves.toEqual({
      success: true,
      result: {
        hits: [
          createHit('nb-1', 'docs/plan.md'),
          createHit('nb-2', 'docs/plan.md'),
        ],
      },
    })
    expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
  })

  it('runs search gate under topology read scope when provided', async () => {
    const mount = createMount('nb-1')
    const topologyScopeEvents: string[] = []
    let topologyScopeCallCount = 0
    const runWithLocalFolderTopologyReadScope = async <T>(task: () => Promise<T>): Promise<T> => {
      topologyScopeCallCount += 1
      topologyScopeEvents.push('enter')
      try {
        return await task()
      } finally {
        topologyScopeEvents.push('exit')
      }
    }
    const searchLocalFolderMount = vi.fn(async () => {
      topologyScopeEvents.push('search')
      return [createHit('nb-1', 'docs/plan.md')]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      runWithLocalFolderTopologyReadScope,
      searchLocalFolderMount,
    })

    const response = await handler({ query: 'alpha' })
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(topologyScopeCallCount).toBe(1)
    expect(topologyScopeEvents).toEqual(['enter', 'exit', 'search'])
  })

  it('uses consistent-read gate when provided', async () => {
    const mount = createMount('nb-1')
    const events: string[] = []
    const waitForLocalFolderMutationTails = vi.fn(() => Promise.resolve())
    let topologyReadCallCount = 0
    const runWithLocalFolderTopologyReadScope = async <T>(task: () => Promise<T>): Promise<T> => {
      topologyReadCallCount += 1
      return task()
    }
    let consistentReadCallCount = 0
    let consistentReadNotebookIds: string[] | undefined
    const runWithLocalFolderConsistentRead = async <T>(
      task: () => Promise<T>,
      notebookIds?: string[]
    ): Promise<T> => {
      consistentReadCallCount += 1
      consistentReadNotebookIds = notebookIds
      events.push(`gate:${(notebookIds ?? []).join(',') || 'global'}`)
      return task()
    }
    const searchLocalFolderMount = vi.fn(async () => {
      events.push('search')
      return [createHit('nb-1', 'docs/plan.md')]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      waitForLocalFolderMutationTails,
      runWithLocalFolderTopologyReadScope,
      runWithLocalFolderConsistentRead,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(consistentReadCallCount).toBe(1)
    expect(consistentReadNotebookIds).toEqual(['nb-1'])
    expect(waitForLocalFolderMutationTails).not.toHaveBeenCalled()
    expect(topologyReadCallCount).toBe(0)
    expect(events).toEqual(['gate:nb-1', 'search'])
  })

  it('keeps scoped hits when root alias changes but canonical root is unchanged', async () => {
    const mount = createMount('nb-1')
    mount.mount.root_path = '/tmp/nb-1-alias-a'
    mount.mount.canonical_root_path = '/tmp/real-nb-1'

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getLocalFolderMountByNotebookId: () => ({
        root_path: '/tmp/nb-1-alias-b',
        canonical_root_path: '/tmp/real-nb-1',
        status: 'active',
      }),
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => [createHit('nb-1', 'docs/plan.md')],
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
  })

  it('reruns scoped search when mount root changes and returns latest mount hits', async () => {
    const initialMount = createMount('nb-1')
    initialMount.mount.root_path = '/tmp/old-nb-1'
    initialMount.mount.canonical_root_path = '/tmp/old-nb-1'

    const latestMount = createMount('nb-1')
    latestMount.mount.root_path = '/tmp/new-nb-1'
    latestMount.mount.canonical_root_path = '/tmp/new-nb-1'

    let mountReadCount = 0
    const getLocalFolderMounts = vi.fn(() => {
      mountReadCount += 1
      return mountReadCount === 1 ? [initialMount] : [latestMount]
    })
    const searchLocalFolderMount = vi.fn(async (mount: LocalFolderNotebookMount) => {
      if (mount.mount.root_path === '/tmp/old-nb-1') {
        return [createHit('nb-1', 'stale/plan.md')]
      }
      return [createHit('nb-1', 'fresh/plan.md')]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts,
      getLocalFolderMountByNotebookId: () => ({
        root_path: '/tmp/new-nb-1',
        canonical_root_path: '/tmp/new-nb-1',
        status: 'active',
      }),
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    expect(getLocalFolderMounts).toHaveBeenCalledTimes(2)
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'fresh/plan.md')] },
    })
  })

  it('drops scoped rerun hits when mount root drifts again before returning response', async () => {
    const initialMount = createMount('nb-1')
    initialMount.mount.root_path = '/tmp/old-nb-1'
    initialMount.mount.canonical_root_path = '/tmp/old-nb-1'

    const rerunMount = createMount('nb-1')
    rerunMount.mount.root_path = '/tmp/new-nb-1'
    rerunMount.mount.canonical_root_path = '/tmp/new-nb-1'

    let getMountByIdCount = 0
    const getLocalFolderMountByNotebookId = vi.fn(() => {
      getMountByIdCount += 1
      if (getMountByIdCount === 1) {
        return {
          root_path: '/tmp/new-nb-1',
          canonical_root_path: '/tmp/new-nb-1',
          status: 'active' as const,
        }
      }
      return {
        root_path: '/tmp/newer-nb-1',
        canonical_root_path: '/tmp/newer-nb-1',
        status: 'active' as const,
      }
    })

    let mountReadCount = 0
    const getLocalFolderMounts = vi.fn(() => {
      mountReadCount += 1
      return mountReadCount === 1 ? [initialMount] : [rerunMount]
    })

    const searchLocalFolderMount = vi.fn(async (mount: LocalFolderNotebookMount) => {
      if (mount.mount.root_path === '/tmp/old-nb-1') {
        return [createHit('nb-1', 'stale/plan.md')]
      }
      return [createHit('nb-1', 'fresh/plan.md')]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts,
      getLocalFolderMountByNotebookId,
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    expect(getLocalFolderMounts).toHaveBeenCalledTimes(2)
    expect(getLocalFolderMountByNotebookId).toHaveBeenCalledTimes(2)
    expect(response).toEqual({
      success: true,
      result: { hits: [] },
    })
  })

  it('keeps global hits when active mount alias changes but canonical root is unchanged', async () => {
    const initialMount = createMount('nb-1')
    initialMount.mount.root_path = '/tmp/nb-1-alias-a'
    initialMount.mount.canonical_root_path = '/tmp/real-nb-1'

    const latestMount = createMount('nb-1')
    latestMount.mount.root_path = '/tmp/nb-1-alias-b'
    latestMount.mount.canonical_root_path = '/tmp/real-nb-1'

    let mountReadCount = 0
    const getLocalFolderMounts = vi.fn(() => {
      mountReadCount += 1
      return mountReadCount === 1 ? [initialMount] : [latestMount]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts,
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => [createHit('nb-1', 'docs/plan.md')],
    })

    const response = await handler({ query: 'alpha' })

    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'docs/plan.md')] },
    })
    expect(getLocalFolderMounts).toHaveBeenCalledTimes(3)
  })

  it('reruns global search for drifted active mount roots and returns latest mount hits', async () => {
    const initialMount = createMount('nb-1')
    initialMount.mount.root_path = '/tmp/old-nb-1'
    initialMount.mount.canonical_root_path = '/tmp/old-nb-1'

    const latestMount = createMount('nb-1')
    latestMount.mount.root_path = '/tmp/new-nb-1'
    latestMount.mount.canonical_root_path = '/tmp/new-nb-1'

    let mountReadCount = 0
    const getLocalFolderMounts = vi.fn(() => {
      mountReadCount += 1
      return mountReadCount === 1 ? [initialMount] : [latestMount]
    })
    const searchLocalFolderMount = vi.fn(async (mount: LocalFolderNotebookMount) => {
      if (mount.mount.root_path === '/tmp/old-nb-1') {
        return [createHit('nb-1', 'stale/plan.md')]
      }
      return [createHit('nb-1', 'fresh/plan.md')]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts,
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({ query: 'alpha' })

    expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    expect(getLocalFolderMounts).toHaveBeenCalledTimes(3)
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-1', 'fresh/plan.md')] },
    })
  })

  it('drops global rerun hits when mount root drifts again before returning response', async () => {
    const initialMount = createMount('nb-1')
    initialMount.mount.root_path = '/tmp/old-nb-1'
    initialMount.mount.canonical_root_path = '/tmp/old-nb-1'

    const rerunMount = createMount('nb-1')
    rerunMount.mount.root_path = '/tmp/new-nb-1'
    rerunMount.mount.canonical_root_path = '/tmp/new-nb-1'

    const finalMount = createMount('nb-1')
    finalMount.mount.root_path = '/tmp/newer-nb-1'
    finalMount.mount.canonical_root_path = '/tmp/newer-nb-1'

    let mountReadCount = 0
    const getLocalFolderMounts = vi.fn(() => {
      mountReadCount += 1
      if (mountReadCount === 1) return [initialMount]
      if (mountReadCount === 2) return [rerunMount]
      return [finalMount]
    })
    const searchLocalFolderMount = vi.fn(async (mount: LocalFolderNotebookMount) => {
      if (mount.mount.root_path === '/tmp/old-nb-1') {
        return [createHit('nb-1', 'stale/plan.md')]
      }
      return [createHit('nb-1', 'fresh/plan.md')]
    })

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts,
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount,
    })

    const response = await handler({ query: 'alpha' })

    expect(searchLocalFolderMount).toHaveBeenCalledTimes(2)
    expect(getLocalFolderMounts).toHaveBeenCalledTimes(3)
    expect(response).toEqual({
      success: true,
      result: { hits: [] },
    })
  })

  it('returns unreadable when scoped mount turns permission-required after search completes', async () => {
    const mount = createMount('nb-1')
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getLocalFolderMountByNotebookId: () => ({
        root_path: '/tmp/nb-1',
        canonical_root_path: '/tmp/nb-1',
        status: 'permission_required',
      }),
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => [createHit('nb-1', 'docs/plan.md')],
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({
      success: false,
      errorCode: 'LOCAL_FILE_UNREADABLE',
    })
  })

  it('returns unreadable error when loading mounts throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => {
        throw new Error('mount list failed')
      },
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
    })

    const response = await handler({ query: 'alpha' })
    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('falls back to raw hits when scoped dedupe throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mount = createMount('nb-1')
    const rawHits = [createHit('nb-1', 'docs/a.md'), createHit('nb-1', 'docs/a.md')]

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => rawHits,
      dedupeHits: () => { throw new Error('dedupe failed') },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: true, result: { hits: rawHits } })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('falls back to raw hits when global dedupe throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mount = createMount('nb-1')
    const rawHits = [createHit('nb-1', 'docs/a.md'), createHit('nb-1', 'docs/a.md')]

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 2,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => rawHits,
      dedupeHits: () => { throw new Error('dedupe failed') },
    })

    const response = await handler({ query: 'alpha' })

    expect(response).toEqual({ success: true, result: { hits: rawHits } })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('marks mount status and returns unreadable error when scoped search fails with permission error', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn(() => 'updated' as const)
    const invalidateCache = vi.fn()
    const stopWatcher = vi.fn()
    const scheduleWatch = vi.fn()
    const enqueueIndexSync = vi.fn()

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: invalidateCache,
      stopLocalFolderWatcher: stopWatcher,
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'permission_required',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(updateStatus).toHaveBeenCalledWith('nb-1', 'permission_required')
    expect(invalidateCache).toHaveBeenCalledWith('nb-1')
    expect(stopWatcher).toHaveBeenCalledWith('nb-1', {
      clearPendingEvent: false,
    })
    expect(scheduleWatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'permission_required',
      reason: 'status_changed',
      changed_relative_path: null,
    })
    expect(enqueueIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      immediate: true,
    })
  })

  it('does not converge mount status for non-fs scoped search failures', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn(() => 'updated' as const)
    const invalidateCache = vi.fn()
    const stopWatcher = vi.fn()
    const scheduleWatch = vi.fn()
    const enqueueIndexSync = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: invalidateCache,
      stopLocalFolderWatcher: stopWatcher,
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw new Error('parser failed')
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(updateStatus).not.toHaveBeenCalled()
    expect(invalidateCache).not.toHaveBeenCalled()
    expect(stopWatcher).not.toHaveBeenCalled()
    expect(scheduleWatch).not.toHaveBeenCalled()
    expect(enqueueIndexSync).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('does not converge mount status for scoped failures with unknown error code', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn(() => 'updated' as const)
    const scheduleWatch = vi.fn()
    const enqueueIndexSync = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: vi.fn(),
      stopLocalFolderWatcher: vi.fn(),
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('non-fs code'), { code: 'PARSER_ERROR' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(updateStatus).not.toHaveBeenCalled()
    expect(scheduleWatch).not.toHaveBeenCalled()
    expect(enqueueIndexSync).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('swallows watcher stop exception when scoped search fails', async () => {
    const mount = createMount('nb-1')
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const updateStatus = vi.fn(() => 'updated' as const)
    const enqueueIndexSync = vi.fn()
    const scheduleWatch = vi.fn()

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: vi.fn(),
      stopLocalFolderWatcher: vi.fn(() => { throw new Error('stop failed') }),
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(updateStatus).toHaveBeenCalledWith('nb-1', 'missing')
    expect(scheduleWatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
      changed_relative_path: null,
    })
    expect(enqueueIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      immediate: true,
    })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('swallows cache invalidation exception when scoped search fails', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn(() => 'updated' as const)
    const scheduleWatch = vi.fn()
    const enqueueIndexSync = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: vi.fn(() => { throw new Error('cache unavailable') }),
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'permission_required',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(updateStatus).toHaveBeenCalledWith('nb-1', 'permission_required')
    expect(scheduleWatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'permission_required',
      reason: 'status_changed',
      changed_relative_path: null,
    })
    expect(enqueueIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      immediate: true,
    })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('falls back to missing status when status resolver throws during scoped search failure', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn(() => 'updated' as const)
    const scheduleWatch = vi.fn()
    const enqueueIndexSync = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: vi.fn(() => { throw new Error('resolver unavailable') }),
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(updateStatus).toHaveBeenCalledWith('nb-1', 'missing')
    expect(scheduleWatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
      changed_relative_path: null,
    })
    expect(enqueueIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      immediate: true,
    })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('deduplicates global hits by notebook and relative path', async () => {
    const mount = createMount('nb-1')
    const duplicateHit = createHit('nb-1', 'docs/plan.md')

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => 'updated' as const),
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => [duplicateHit, { ...duplicateHit }],
    })

    const response = await handler({ query: 'alpha' })
    expect(response.success).toBe(true)
    if (!response.success) return

    expect(response.result.hits).toEqual([duplicateHit])
  })

  it('returns not found and skips status_changed when scoped search fails but mount status update reports row missing', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn(() => 'not_found' as const)
    const scheduleWatch = vi.fn()
    const invalidateCache = vi.fn()

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: vi.fn(),
      invalidateLocalFolderTreeCache: invalidateCache,
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'permission_required',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' })
    expect(updateStatus).toHaveBeenCalledWith('nb-1', 'permission_required')
    expect(invalidateCache).toHaveBeenCalledWith('nb-1')
    expect(scheduleWatch).not.toHaveBeenCalled()
  })

  it('uses latest persisted unavailable status when scoped search failure update is conflicted', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn(() => 'conflict' as const)
    const scheduleWatch = vi.fn()
    const enqueueIndexSync = vi.fn()

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getLocalFolderMountByNotebookId: () => ({ root_path: '/tmp/nb-1', status: 'permission_required' }),
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(updateStatus).toHaveBeenCalledWith('nb-1', 'missing')
    expect(scheduleWatch).not.toHaveBeenCalled()
    expect(enqueueIndexSync).not.toHaveBeenCalled()
  })

  it('swallows status persistence exception when scoped search fails', async () => {
    const mount = createMount('nb-1')
    const statusError = new Error('db unavailable')
    const scheduleWatch = vi.fn()
    const enqueueIndexSync = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(() => { throw statusError }),
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'permission_required',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    })

    const response = await handler({
      query: 'alpha',
      notebook_id: 'nb-1',
      folder_relative_path: 'docs',
    })

    expect(response).toEqual({ success: false, errorCode: 'LOCAL_FILE_UNREADABLE' })
    expect(scheduleWatch).not.toHaveBeenCalled()
    expect(enqueueIndexSync).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('global search failure on one mount emits status convergence and keeps other mount hits', async () => {
    const mountA = createMount('nb-1')
    const mountB = createMount('nb-2')
    const enqueueIndexSync = vi.fn()
    const scheduleWatch = vi.fn()

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mountA, mountB],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn((notebookId: string) =>
        notebookId === 'nb-1' ? 'updated' as const : 'not_found' as const
      ),
      enqueueLocalNotebookIndexSync: enqueueIndexSync,
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async (mount) => {
        if (mount.notebook.id === 'nb-1') {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        }
        return [createHit('nb-2', 'docs/ok.md')]
      },
    })

    const response = await handler({ query: 'alpha' })
    expect(response).toEqual({
      success: true,
      result: { hits: [createHit('nb-2', 'docs/ok.md')] },
    })
    expect(enqueueIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      immediate: true,
    })
    expect(scheduleWatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'missing',
      reason: 'status_changed',
      changed_relative_path: null,
    })
  })
})
