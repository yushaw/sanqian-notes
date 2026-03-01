import { relative } from 'path'
import {
  getLocalFolderMounts,
  getLocalFolderMountByNotebookId,
  updateLocalFolderMountStatus,
} from '../database'
import {
  createFileSystemWatcher,
  isRecoverableWatchError,
  resolveMountStatusFromFsError,
} from '../local-folder-watch'
import { normalizeRelativeSlashPath } from '../path-compat'
import {
  invalidateLocalFolderTreeCache,
  clearLocalFolderTreeCache,
  deleteLocalFolderTreeCacheEntry,
  getLocalFolderTreeCacheKeys,
} from '../local-folder-tree-cache'
import {
  cancelPendingLocalNotebookIndexSync,
  resetLocalNotebookIndexSyncState,
  enqueueLocalNotebookIndexSync,
} from '../local-notebook-index'
import {
  scheduleLocalFolderWatchEvent,
  clearWatchEventSchedule,
  clearAllWatchEventSchedules,
  deleteWatchSequence,
  clearAllWatchSequences,
} from './event-scheduler'

const LOCAL_FOLDER_WATCHER_RESTART_DELAY_MS = 1200

const localFolderWatchers = new Map<string, ReturnType<typeof createFileSystemWatcher>>()
const localFolderWatcherRestartTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearLocalFolderWatcherRestartTimer(notebookId: string): void {
  const timer = localFolderWatcherRestartTimers.get(notebookId)
  if (!timer) return
  clearTimeout(timer)
  localFolderWatcherRestartTimers.delete(notebookId)
}

function resolveWatchChangedRelativePath(rootPath: string, absolutePath: string | null): string | null {
  if (!absolutePath) return null
  const relativePath = normalizeRelativeSlashPath(relative(rootPath, absolutePath))
  if (!relativePath || relativePath === '.') return null
  if (relativePath === '..' || relativePath.startsWith('../')) return null
  return relativePath
}

function scheduleLocalFolderWatcherRestart(notebookId: string, delayMs: number = LOCAL_FOLDER_WATCHER_RESTART_DELAY_MS): void {
  if (localFolderWatcherRestartTimers.has(notebookId)) return
  const timer = setTimeout(() => {
    localFolderWatcherRestartTimers.delete(notebookId)
    const mount = getLocalFolderMountByNotebookId(notebookId)
    if (!mount || mount.status !== 'active') return
    stopLocalFolderWatcher(notebookId, { clearPendingEvent: false, clearRestartTimer: false })
    ensureLocalFolderWatcher(notebookId, mount.root_path)
  }, Math.max(200, delayMs))
  localFolderWatcherRestartTimers.set(notebookId, timer)
}

export function stopLocalFolderWatcher(
  notebookId: string,
  options?: { clearPendingEvent?: boolean; clearRestartTimer?: boolean }
): void {
  if (options?.clearPendingEvent !== false) {
    clearWatchEventSchedule(notebookId)
  }
  if (options?.clearRestartTimer !== false) {
    clearLocalFolderWatcherRestartTimer(notebookId)
  }
  const watcher = localFolderWatchers.get(notebookId)
  if (!watcher) return
  watcher.close()
  localFolderWatchers.delete(notebookId)
}

export function stopAllLocalFolderWatchers(): void {
  clearAllWatchEventSchedules()
  cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
  resetLocalNotebookIndexSyncState()
  for (const notebookId of Array.from(localFolderWatcherRestartTimers.keys())) {
    clearLocalFolderWatcherRestartTimer(notebookId)
  }
  Array.from(localFolderWatchers.keys()).forEach((notebookId) => {
    stopLocalFolderWatcher(notebookId)
  })
  clearLocalFolderTreeCache()
  clearAllWatchSequences()
}

export function ensureLocalFolderWatcher(mountNotebookId: string, rootPath: string): void {
  if (localFolderWatchers.has(mountNotebookId)) return

  try {
    const watcher = createFileSystemWatcher(rootPath, (change) => {
      const mount = getLocalFolderMountByNotebookId(mountNotebookId)
      if (!mount) return
      if (mount.status !== 'active') {
        updateLocalFolderMountStatus(mountNotebookId, 'active')
      }
      invalidateLocalFolderTreeCache(mountNotebookId)
      const changedRelativePath = resolveWatchChangedRelativePath(mount.root_path, change.absolutePath)
      scheduleLocalFolderWatchEvent({
        notebook_id: mountNotebookId,
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: changedRelativePath,
      })
      enqueueLocalNotebookIndexSync(mountNotebookId, {
        full: !changedRelativePath,
        changedRelativePath,
      })
    })

    watcher.on('error', (error) => {
      invalidateLocalFolderTreeCache(mountNotebookId)
      if (isRecoverableWatchError(error)) {
        stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false, clearRestartTimer: false })
        scheduleLocalFolderWatchEvent({
          notebook_id: mountNotebookId,
          status: 'active',
          reason: 'rescan_required',
          changed_relative_path: null,
        })
        enqueueLocalNotebookIndexSync(mountNotebookId, {
          full: true,
        })
        scheduleLocalFolderWatcherRestart(mountNotebookId)
        return
      }

      const nextStatus = resolveMountStatusFromFsError(error)
      updateLocalFolderMountStatus(mountNotebookId, nextStatus)
      stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false })
      scheduleLocalFolderWatchEvent({
        notebook_id: mountNotebookId,
        status: nextStatus,
        reason: 'status_changed',
        changed_relative_path: null,
      })
      enqueueLocalNotebookIndexSync(mountNotebookId, {
        full: true,
      })
    })

    localFolderWatchers.set(mountNotebookId, watcher)
    clearLocalFolderWatcherRestartTimer(mountNotebookId)
  } catch (error) {
    if (isRecoverableWatchError(error)) {
      invalidateLocalFolderTreeCache(mountNotebookId)
      scheduleLocalFolderWatchEvent({
        notebook_id: mountNotebookId,
        status: 'active',
        reason: 'rescan_required',
        changed_relative_path: null,
      })
      enqueueLocalNotebookIndexSync(mountNotebookId, {
        full: true,
      })
      scheduleLocalFolderWatcherRestart(mountNotebookId)
      return
    }

    const nextStatus = resolveMountStatusFromFsError(error)
    updateLocalFolderMountStatus(mountNotebookId, nextStatus)
    invalidateLocalFolderTreeCache(mountNotebookId)
    scheduleLocalFolderWatchEvent({
      notebook_id: mountNotebookId,
      status: nextStatus,
      reason: 'status_changed',
      changed_relative_path: null,
    })
    enqueueLocalNotebookIndexSync(mountNotebookId, {
      full: true,
    })
  }
}

export function syncLocalFolderWatchers(): void {
  const mounts = getLocalFolderMounts()
  const activeNotebookIds = new Set(mounts.map((mount) => mount.notebook.id))

  for (const notebookId of localFolderWatchers.keys()) {
    if (!activeNotebookIds.has(notebookId)) {
      stopLocalFolderWatcher(notebookId)
      invalidateLocalFolderTreeCache(notebookId)
    }
  }

  for (const notebookId of getLocalFolderTreeCacheKeys()) {
    if (!activeNotebookIds.has(notebookId)) {
      deleteLocalFolderTreeCacheEntry(notebookId)
    }
  }

  for (const notebookId of Array.from(localFolderWatcherRestartTimers.keys())) {
    if (!activeNotebookIds.has(notebookId)) {
      clearLocalFolderWatcherRestartTimer(notebookId)
    }
  }

  for (const notebookId of Array.from(localFolderWatchers.keys())) {
    if (!activeNotebookIds.has(notebookId)) {
      deleteWatchSequence(notebookId)
    }
  }

  for (const mount of mounts) {
    const hadWatcher = localFolderWatchers.has(mount.notebook.id)
    ensureLocalFolderWatcher(mount.notebook.id, mount.mount.root_path)
    if (!hadWatcher) {
      enqueueLocalNotebookIndexSync(mount.notebook.id, { full: true })
    }
  }
}
