import { describe, expect, it, vi } from 'vitest'
import type {
  LocalFolderNotebookMount,
  LocalFolderSearchHit,
  NotebookStatus,
} from '../../shared/types'
import { createLocalFolderSearchHandler } from '../local-folder-search-ipc'

function createMount(id: string, status: NotebookStatus = 'active'): LocalFolderNotebookMount {
  const now = '2026-02-26T00:00:00.000Z'
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
      root_path: `/tmp/${id}`,
      canonical_root_path: `/tmp/${id}`,
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
    const updateStatus = vi.fn()
    const invalidateCache = vi.fn()
    const scheduleWatch = vi.fn()

    let active = 0
    let maxActive = 0
    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => mounts,
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
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

  it('marks mount status and returns unreadable error when scoped search fails with permission error', async () => {
    const mount = createMount('nb-1')
    const updateStatus = vi.fn()
    const invalidateCache = vi.fn()
    const scheduleWatch = vi.fn()

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: updateStatus,
      invalidateLocalFolderTreeCache: invalidateCache,
      scheduleLocalFolderWatchEvent: scheduleWatch,
      resolveMountStatusFromFsError: () => 'permission_required',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      searchLocalFolderMount: async () => {
        throw new Error('EACCES')
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
    expect(scheduleWatch).toHaveBeenCalledWith({
      notebook_id: 'nb-1',
      status: 'permission_required',
      reason: 'status_changed',
      changed_relative_path: null,
    })
  })

  it('deduplicates global hits by notebook and relative path', async () => {
    const mount = createMount('nb-1')
    const duplicateHit = createHit('nb-1', 'docs/plan.md')

    const handler = createLocalFolderSearchHandler({
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(),
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
})
