import { describe, expect, it, vi } from 'vitest'
import type {
  LocalFolderNotebookMount,
  LocalFolderSearchHit,
  NotebookStatus,
} from '../../shared/types'
import { registerLocalFolderSearchIpc } from '../ipc/register-local-folder-search-ipc'

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

describe('register-local-folder-search-ipc', () => {
  it('registers ipcMain.handle and routes requests through local folder search handler', async () => {
    const mount = createMount('nb-1')
    const channels = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>()
    const ipcMainLike = {
      handle: vi.fn((channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>) => {
        channels.set(channel, listener)
      }),
    }

    registerLocalFolderSearchIpc(ipcMainLike, {
      getLocalFolderMounts: () => [mount],
      getCachedLocalFolderTree: () => null,
      updateLocalFolderMountStatus: vi.fn(),
      invalidateLocalFolderTreeCache: vi.fn(),
      scheduleLocalFolderWatchEvent: vi.fn(),
      resolveMountStatusFromFsError: () => 'missing',
      globalSearchConcurrency: 4,
      searchScanCacheTtlMs: 1200,
      dedupeHits: (hits) => hits,
      searchLocalFolderMount: async () => [createHit('nb-1', 'docs/plan.md')],
    })

    expect(ipcMainLike.handle).toHaveBeenCalledTimes(1)
    expect(channels.has('localFolder:search')).toBe(true)

    const handler = channels.get('localFolder:search')
    expect(handler).toBeDefined()
    if (!handler) return

    const response = await handler({}, { query: 'plan' })
    expect(response).toEqual({
      success: true,
      result: {
        hits: [createHit('nb-1', 'docs/plan.md')],
      },
    })
  })
})
