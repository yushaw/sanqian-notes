import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureLocalFolderWatcher,
  stopAllLocalFolderWatchers,
  syncLocalFolderWatchers,
  scheduleSyncLocalFolderWatchers,
} from '../local-folder-watcher/manager'
import { getLocalFolderMountByNotebookId, getLocalFolderMounts, updateLocalFolderMountStatus } from '../database'
import { createFileSystemWatcher } from '../local-folder-watch'
import { enqueueLocalNotebookIndexSync, hasPendingFullIndexSyncForNotebook } from '../local-notebook-index'
import { deleteWatchSequence, scheduleLocalFolderWatchEvent } from '../local-folder-watcher/event-scheduler'
import { invalidateLocalFolderTreeCache } from '../local-folder-tree-cache'

vi.mock('../database', () => ({
  getLocalFolderMounts: vi.fn(() => []),
  getLocalFolderMountByNotebookId: vi.fn(() => ({
    notebook_id: 'nb-1',
    root_path: '/root',
    status: 'active',
  })),
  updateLocalFolderMountStatus: vi.fn(() => 'updated'),
}))

vi.mock('../local-folder-watch', () => ({
  createFileSystemWatcher: vi.fn(),
  isRecoverableWatchError: vi.fn(() => false),
  resolveMountStatusFromFsError: vi.fn(() => 'missing'),
}))

vi.mock('../local-folder-tree-cache', () => ({
  invalidateLocalFolderTreeCache: vi.fn(),
  clearLocalFolderTreeCache: vi.fn(),
  deleteLocalFolderTreeCacheEntry: vi.fn(),
  getLocalFolderTreeCacheKeys: vi.fn(() => [][Symbol.iterator]()),
}))

vi.mock('../local-notebook-index', () => ({
  cancelPendingLocalNotebookIndexSync: vi.fn(),
  resetLocalNotebookIndexSyncState: vi.fn(),
  enqueueLocalNotebookIndexSync: vi.fn(),
  hasPendingFullIndexSyncForNotebook: vi.fn(() => false),
}))

vi.mock('../local-folder-watcher/event-scheduler', () => ({
  scheduleLocalFolderWatchEvent: vi.fn(),
  clearWatchEventSchedule: vi.fn(),
  clearAllWatchEventSchedules: vi.fn(),
  deleteWatchSequence: vi.fn(),
  clearAllWatchSequences: vi.fn(),
}))

describe('local-folder-watcher manager', () => {
  let onChanged: ((change: { eventType: 'rename' | 'change' | 'unknown'; absolutePath: string | null }) => void) | null = null
  let watcherEmitter: (EventEmitter & { close: () => void }) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    onChanged = null
    watcherEmitter = null
    vi.mocked(hasPendingFullIndexSyncForNotebook).mockReturnValue(false)
    vi.mocked(getLocalFolderMountByNotebookId).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/root',
      status: 'active',
    } as any)

    vi.mocked(createFileSystemWatcher).mockImplementation((_rootPath, callback) => {
      onChanged = callback
      const watcher = new EventEmitter() as EventEmitter & { close: () => void }
      watcher.close = vi.fn()
      watcherEmitter = watcher
      return watcher as ReturnType<typeof createFileSystemWatcher>
    })
  })

  afterEach(() => {
    stopAllLocalFolderWatchers()
    delete process.env.LOCAL_FOLDER_WATCHER_EVENT_WARMUP_MS
    delete process.env.LOCAL_FOLDER_WATCHER_STARTUP_EVENT_WARMUP_MS
    vi.useRealTimers()
  })

  it('enqueues incremental sync for markdown/txt file changes', () => {
    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'change', absolutePath: '/root/docs/note.md' })

    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'content_changed',
      changed_relative_path: 'docs/note.md',
    }))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: false,
      changedRelativePath: 'docs/note.md',
    })
  })

  it('coalesces warmup watch events into a single full sync request', () => {
    process.env.LOCAL_FOLDER_WATCHER_EVENT_WARMUP_MS = '1200'

    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'change', absolutePath: '/root/docs/note.md' })

    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'content_changed',
      changed_relative_path: null,
    }))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      changedRelativePath: null,
    })
  })

  it('does not enqueue extra full sync during warmup when one is already pending', () => {
    process.env.LOCAL_FOLDER_WATCHER_EVENT_WARMUP_MS = '1200'
    vi.mocked(hasPendingFullIndexSyncForNotebook).mockReturnValue(true)

    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'change', absolutePath: '/root/docs/note.md' })

    expect(scheduleLocalFolderWatchEvent).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
  })

  it('falls back to full sync for directory/non-note changes', () => {
    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'rename', absolutePath: '/root/docs' })

    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'content_changed',
      changed_relative_path: null,
    }))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      changedRelativePath: null,
    })
  })

  it('falls back to full sync for non-note file changes', () => {
    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'change', absolutePath: '/root/assets/cover.png' })

    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'content_changed',
      changed_relative_path: null,
    }))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
      changedRelativePath: null,
    })
  })

  it('ignores hidden path events', () => {
    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'change', absolutePath: '/root/.tmp/note.md' })

    expect(scheduleLocalFolderWatchEvent).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
  })

  it('does not emit active content events when status promotion is rejected', () => {
    vi.mocked(getLocalFolderMountByNotebookId).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/root',
      status: 'missing',
    } as any)
    vi.mocked(updateLocalFolderMountStatus).mockReturnValue('not_found')

    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'change', absolutePath: '/root/docs/note.md' })

    expect(updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'active')
    expect(scheduleLocalFolderWatchEvent).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
  })

  it('swallows status persistence exception during promotion and stops converging events', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getLocalFolderMountByNotebookId).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/root',
      status: 'missing',
    } as any)
    vi.mocked(updateLocalFolderMountStatus).mockImplementation(() => {
      throw new Error('db unavailable')
    })

    ensureLocalFolderWatcher('nb-1', '/root')
    onChanged?.({ eventType: 'change', absolutePath: '/root/docs/note.md' })

    expect(updateLocalFolderMountStatus).toHaveBeenCalledWith('nb-1', 'active')
    expect(scheduleLocalFolderWatchEvent).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('cleans watcher sequence for notebooks removed from mount list', () => {
    ensureLocalFolderWatcher('nb-1', '/root')
    vi.mocked(getLocalFolderMounts).mockReturnValue([])

    syncLocalFolderWatchers()

    expect(deleteWatchSequence).toHaveBeenCalledWith('nb-1')
  })

  it('does not create watcher for non-active mounts during sync', () => {
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root',
          status: 'missing',
        },
      } as any,
    ])

    syncLocalFolderWatchers()

    expect(createFileSystemWatcher).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
    expect(invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
  })

  it('enqueues full sync when syncing active mount without watcher', () => {
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root',
          status: 'active',
        },
      } as any,
    ])

    syncLocalFolderWatchers()

    expect(createFileSystemWatcher).toHaveBeenCalledWith('/root', expect.any(Function))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', { full: true })
  })

  it('skips bootstrap full sync when notebook already has pending full index sync', () => {
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root',
          status: 'active',
        },
      } as any,
    ])
    vi.mocked(hasPendingFullIndexSyncForNotebook).mockReturnValue(true)

    syncLocalFolderWatchers()

    expect(createFileSystemWatcher).toHaveBeenCalledWith('/root', expect.any(Function))
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
  })

  it('does not enqueue duplicate full sync when watcher creation fails during sync', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root',
          status: 'active',
        },
      } as any,
    ])
    vi.mocked(createFileSystemWatcher).mockImplementation(() => {
      throw new Error('watcher bootstrap failed')
    })

    syncLocalFolderWatchers()

    expect(updateLocalFolderMountStatus).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledTimes(1)
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', { full: true })
    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'active',
      reason: 'rescan_required',
    }))
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('does not downgrade mount status on non-fs watcher runtime error', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ensureLocalFolderWatcher('nb-1', '/root')
    watcherEmitter?.emit('error', new Error('watch callback failed'))

    expect(updateLocalFolderMountStatus).not.toHaveBeenCalled()
    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      status: 'active',
      reason: 'rescan_required',
    }))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: true,
    })
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('does not enqueue full sync for mounts that already have watcher', () => {
    ensureLocalFolderWatcher('nb-1', '/root')
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root',
          status: 'active',
        },
      } as any,
    ])

    syncLocalFolderWatchers()

    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
  })

  it('restarts watcher when ensure is called with a different root path', () => {
    const firstWatcher = new EventEmitter() as EventEmitter & { close: () => void }
    firstWatcher.close = vi.fn()
    const secondWatcher = new EventEmitter() as EventEmitter & { close: () => void }
    secondWatcher.close = vi.fn()

    vi.mocked(createFileSystemWatcher)
      .mockImplementationOnce((_rootPath, callback) => {
        onChanged = callback
        watcherEmitter = firstWatcher
        return firstWatcher as ReturnType<typeof createFileSystemWatcher>
      })
      .mockImplementationOnce((_rootPath, callback) => {
        onChanged = callback
        watcherEmitter = secondWatcher
        return secondWatcher as ReturnType<typeof createFileSystemWatcher>
      })

    ensureLocalFolderWatcher('nb-1', '/root-a')
    ensureLocalFolderWatcher('nb-1', '/root-b')

    expect(createFileSystemWatcher).toHaveBeenNthCalledWith(1, '/root-a', expect.any(Function))
    expect(createFileSystemWatcher).toHaveBeenNthCalledWith(2, '/root-b', expect.any(Function))
    expect(firstWatcher.close).toHaveBeenCalledTimes(1)
    expect(secondWatcher.close).not.toHaveBeenCalled()
  })

  it('restarts watcher and enqueues full sync when mount root path changes during sync', () => {
    const firstWatcher = new EventEmitter() as EventEmitter & { close: () => void }
    firstWatcher.close = vi.fn()
    const secondWatcher = new EventEmitter() as EventEmitter & { close: () => void }
    secondWatcher.close = vi.fn()

    vi.mocked(createFileSystemWatcher)
      .mockImplementationOnce((_rootPath, callback) => {
        onChanged = callback
        watcherEmitter = firstWatcher
        return firstWatcher as ReturnType<typeof createFileSystemWatcher>
      })
      .mockImplementationOnce((_rootPath, callback) => {
        onChanged = callback
        watcherEmitter = secondWatcher
        return secondWatcher as ReturnType<typeof createFileSystemWatcher>
      })

    ensureLocalFolderWatcher('nb-1', '/root-a')
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root-b',
          status: 'active',
        },
      } as any,
    ])

    syncLocalFolderWatchers()

    expect(createFileSystemWatcher).toHaveBeenNthCalledWith(1, '/root-a', expect.any(Function))
    expect(createFileSystemWatcher).toHaveBeenNthCalledWith(2, '/root-b', expect.any(Function))
    expect(firstWatcher.close).toHaveBeenCalledTimes(1)
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', { full: true })
    expect(secondWatcher.close).not.toHaveBeenCalled()
  })

  it('keeps watcher and incremental path mapping when mount root alias changes with same canonical root', () => {
    ensureLocalFolderWatcher('nb-1', '/root-a', '/canonical-root')
    vi.mocked(getLocalFolderMountByNotebookId).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/root-b',
      canonical_root_path: '/canonical-root',
      status: 'active',
    } as any)

    onChanged?.({ eventType: 'change', absolutePath: '/root-a/docs/note.md' })

    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1)
    expect(watcherEmitter?.close).not.toHaveBeenCalled()
    expect(scheduleLocalFolderWatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      notebook_id: 'nb-1',
      reason: 'content_changed',
      changed_relative_path: 'docs/note.md',
    }))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', {
      full: false,
      changedRelativePath: 'docs/note.md',
    })
  })

  it('does not restart watcher during sync when mount root alias changes with same canonical root', () => {
    ensureLocalFolderWatcher('nb-1', '/root-a', '/canonical-root')
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root-b',
          canonical_root_path: '/canonical-root',
          status: 'active',
        },
      } as any,
    ])

    syncLocalFolderWatchers()

    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1)
    expect(watcherEmitter?.close).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()
  })

  it('ignores stale watcher events after root drift and fast-resyncs watcher to latest root', () => {
    vi.useFakeTimers()
    const firstWatcher = new EventEmitter() as EventEmitter & { close: () => void }
    firstWatcher.close = vi.fn()
    const secondWatcher = new EventEmitter() as EventEmitter & { close: () => void }
    secondWatcher.close = vi.fn()

    vi.mocked(createFileSystemWatcher)
      .mockImplementationOnce((_rootPath, callback) => {
        onChanged = callback
        watcherEmitter = firstWatcher
        return firstWatcher as ReturnType<typeof createFileSystemWatcher>
      })
      .mockImplementationOnce((_rootPath, callback) => {
        onChanged = callback
        watcherEmitter = secondWatcher
        return secondWatcher as ReturnType<typeof createFileSystemWatcher>
      })

    vi.mocked(getLocalFolderMountByNotebookId).mockReturnValue({
      notebook_id: 'nb-1',
      root_path: '/root-b',
      status: 'active',
    } as any)
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root-b',
          status: 'active',
        },
      } as any,
    ])

    ensureLocalFolderWatcher('nb-1', '/root-a')
    onChanged?.({ eventType: 'change', absolutePath: '/root-a/docs/note.md' })

    expect(firstWatcher.close).toHaveBeenCalledTimes(1)
    expect(invalidateLocalFolderTreeCache).toHaveBeenCalledWith('nb-1')
    expect(scheduleLocalFolderWatchEvent).not.toHaveBeenCalled()
    expect(enqueueLocalNotebookIndexSync).not.toHaveBeenCalled()

    vi.advanceTimersByTime(0)
    expect(createFileSystemWatcher).toHaveBeenNthCalledWith(1, '/root-a', expect.any(Function))
    expect(createFileSystemWatcher).toHaveBeenNthCalledWith(2, '/root-b', expect.any(Function))
    expect(enqueueLocalNotebookIndexSync).toHaveBeenCalledWith('nb-1', { full: true })
    expect(secondWatcher.close).not.toHaveBeenCalled()
  })

  it('swallows watcher close exception when removing stale watchers', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(createFileSystemWatcher).mockImplementation((_rootPath, callback) => {
      onChanged = callback
      const watcher = new EventEmitter() as EventEmitter & { close: () => void }
      watcher.close = vi.fn(() => { throw new Error('close failed') })
      return watcher as ReturnType<typeof createFileSystemWatcher>
    })

    ensureLocalFolderWatcher('nb-1', '/root')
    vi.mocked(getLocalFolderMounts).mockReturnValue([])

    expect(() => syncLocalFolderWatchers()).not.toThrow()
    expect(deleteWatchSequence).toHaveBeenCalledWith('nb-1')
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('coalesces scheduled watcher sync requests', () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root',
          status: 'active',
        },
      } as any,
    ])

    scheduleSyncLocalFolderWatchers(80)
    scheduleSyncLocalFolderWatchers(80)

    expect(createFileSystemWatcher).not.toHaveBeenCalled()
    vi.advanceTimersByTime(79)
    expect(createFileSystemWatcher).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1)
  })

  it('syncLocalFolderWatchers executes immediately and cancels pending scheduled sync', () => {
    vi.useFakeTimers()
    vi.mocked(getLocalFolderMounts).mockReturnValue([
      {
        notebook: { id: 'nb-1' },
        mount: {
          notebook_id: 'nb-1',
          root_path: '/root',
          status: 'active',
        },
      } as any,
    ])

    scheduleSyncLocalFolderWatchers(120)
    syncLocalFolderWatchers()

    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(120)
    expect(createFileSystemWatcher).toHaveBeenCalledTimes(1)
  })
})
