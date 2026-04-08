import { extname, relative } from 'path'
import type { NotebookStatus } from '../../shared/types'
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
import { resolveUnavailableMountStatusFromFsError } from '../local-folder-mount-fs-error'
import {
  normalizeRelativeSlashPath,
} from '../path-compat'
import {
  resolveComparableLocalFolderRootPath,
  resolveLocalFolderCanonicalOrRootPath,
} from '../local-folder-root-match'
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
  hasPendingFullIndexSyncForNotebook,
} from '../local-notebook-index'
import { getStartupPhaseState } from '../startup-phase'
import {
  scheduleLocalFolderWatchEvent,
  clearWatchEventSchedule,
  clearAllWatchEventSchedules,
  deleteWatchSequence,
  clearAllWatchSequences,
} from './event-scheduler'
import { applyLocalFolderMountStatusTransition } from '../local-folder-mount-transition'

const LOCAL_FOLDER_WATCHER_RESTART_DELAY_MS = 1200
const LOCAL_FOLDER_WATCHER_SYNC_DEBOUNCE_MS = Number.isFinite(Number(process.env.LOCAL_FOLDER_WATCHER_SYNC_DEBOUNCE_MS))
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_FOLDER_WATCHER_SYNC_DEBOUNCE_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 120)
const LOCAL_FOLDER_WATCHER_EVENT_WARMUP_MS_DEFAULT = process.env.NODE_ENV === 'test' ? 0 : 300
const LOCAL_FOLDER_WATCHER_EVENT_STARTUP_WARMUP_MS_DEFAULT = process.env.NODE_ENV === 'test' ? 0 : 1500

const localFolderWatchers = new Map<string, ReturnType<typeof createFileSystemWatcher>>()
const localFolderWatcherComparableMountPathByNotebook = new Map<string, string>()
const localFolderWatcherRestartTimers = new Map<string, ReturnType<typeof setTimeout>>()
const localFolderWatcherEventWarmupUntilMsByNotebook = new Map<string, number>()
let localFolderWatchersSyncTimer: ReturnType<typeof setTimeout> | null = null

function resolveComparableLocalFolderMountPath(
  mountLike: { root_path: string; canonical_root_path?: string | null }
): string {
  return resolveComparableLocalFolderRootPath(mountLike)
}

function resolveLocalFolderWatcherEventWarmupMs(): number {
  const baseWarmupMsRaw = Number(process.env.LOCAL_FOLDER_WATCHER_EVENT_WARMUP_MS)
  const baseWarmupMs = Number.isFinite(baseWarmupMsRaw)
    ? Math.max(0, Math.floor(baseWarmupMsRaw))
    : LOCAL_FOLDER_WATCHER_EVENT_WARMUP_MS_DEFAULT

  const startupWarmupMsRaw = Number(process.env.LOCAL_FOLDER_WATCHER_STARTUP_EVENT_WARMUP_MS)
  const startupWarmupMs = Number.isFinite(startupWarmupMsRaw)
    ? Math.max(0, Math.floor(startupWarmupMsRaw))
    : LOCAL_FOLDER_WATCHER_EVENT_STARTUP_WARMUP_MS_DEFAULT

  const startupState = getStartupPhaseState()
  if (!startupState.inStartupPhase) return baseWarmupMs
  return Math.max(baseWarmupMs, startupWarmupMs)
}

function clearLocalFolderWatcherRestartTimer(notebookId: string): void {
  const timer = localFolderWatcherRestartTimers.get(notebookId)
  if (!timer) return
  clearTimeout(timer)
  localFolderWatcherRestartTimers.delete(notebookId)
}

function clearScheduledLocalFolderWatchersSync(): void {
  if (!localFolderWatchersSyncTimer) return
  clearTimeout(localFolderWatchersSyncTimer)
  localFolderWatchersSyncTimer = null
}

function resolveWatchChangedRelativePath(rootPath: string, absolutePath: string | null): string | null {
  if (!absolutePath) return null
  const relativePath = normalizeRelativeSlashPath(relative(rootPath, absolutePath))
  if (!relativePath || relativePath === '.') return null
  if (relativePath === '..' || relativePath.startsWith('../')) return null
  return relativePath
}

function isHiddenRelativePath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'))
}

function resolveIndexSyncRelativePath(relativePath: string | null): string | null {
  if (!relativePath) return null
  const extension = extname(relativePath).toLowerCase()
  if (extension !== '.md' && extension !== '.txt') {
    return null
  }
  return relativePath
}

function scheduleLocalFolderWatcherRestart(notebookId: string, delayMs: number = LOCAL_FOLDER_WATCHER_RESTART_DELAY_MS): void {
  if (localFolderWatcherRestartTimers.has(notebookId)) return
  const timer = setTimeout(() => {
    localFolderWatcherRestartTimers.delete(notebookId)
    const mount = getLocalFolderMountByNotebookId(notebookId)
    if (!mount || mount.status !== 'active') return
    stopLocalFolderWatcher(notebookId, { clearPendingEvent: false, clearRestartTimer: false })
    ensureLocalFolderWatcher(notebookId, mount.root_path, resolveLocalFolderCanonicalOrRootPath(mount))
  }, Math.max(200, delayMs))
  localFolderWatcherRestartTimers.set(notebookId, timer)
}

function scheduleWatcherRescanRecovery(notebookId: string): void {
  invalidateLocalFolderTreeCache(notebookId)
  scheduleLocalFolderWatchEvent({
    notebook_id: notebookId,
    status: 'active',
    reason: 'rescan_required',
    changed_relative_path: null,
  })
  enqueueLocalNotebookIndexSync(notebookId, {
    full: true,
  })
  scheduleLocalFolderWatcherRestart(notebookId)
}

function resolveWatcherUnavailableStatus(
  notebookId: string,
  error: unknown
): Extract<NotebookStatus, 'missing' | 'permission_required'> | null {
  try {
    return resolveUnavailableMountStatusFromFsError(error, resolveMountStatusFromFsError)
  } catch (resolveStatusError) {
    console.error(
      `[local-folder-watcher] failed to resolve mount status from watcher error: notebook=${notebookId}`,
      resolveStatusError
    )
    return 'missing'
  }
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
  localFolderWatcherComparableMountPathByNotebook.delete(notebookId)
  localFolderWatcherEventWarmupUntilMsByNotebook.delete(notebookId)
  const watcher = localFolderWatchers.get(notebookId)
  if (!watcher) return
  try {
    watcher.close()
  } catch (error) {
    console.error(`[local-folder-watcher] failed to close watcher: notebook=${notebookId}`, error)
  } finally {
    localFolderWatchers.delete(notebookId)
  }
}

export function stopAllLocalFolderWatchers(): void {
  clearAllWatchEventSchedules()
  clearScheduledLocalFolderWatchersSync()
  cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
  resetLocalNotebookIndexSyncState()
  localFolderWatcherComparableMountPathByNotebook.clear()
  localFolderWatcherEventWarmupUntilMsByNotebook.clear()
  for (const notebookId of Array.from(localFolderWatcherRestartTimers.keys())) {
    clearLocalFolderWatcherRestartTimer(notebookId)
  }
  Array.from(localFolderWatchers.keys()).forEach((notebookId) => {
    stopLocalFolderWatcher(notebookId)
  })
  clearLocalFolderTreeCache()
  clearAllWatchSequences()
}

export function ensureLocalFolderWatcher(
  mountNotebookId: string,
  rootPath: string,
  canonicalRootPath: string = rootPath
): void {
  const expectedComparableMountPath = resolveComparableLocalFolderMountPath({
    root_path: rootPath,
    canonical_root_path: canonicalRootPath,
  })
  const existingWatcher = localFolderWatchers.get(mountNotebookId)
  if (existingWatcher) {
    const existingComparableMountPath = localFolderWatcherComparableMountPathByNotebook.get(mountNotebookId)
    if (existingComparableMountPath === expectedComparableMountPath) {
      return
    }
    stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false, clearRestartTimer: false })
  }

  try {
    const watcher = createFileSystemWatcher(rootPath, (change) => {
      const mount = getLocalFolderMountByNotebookId(mountNotebookId)
      if (!mount) return
      const mountedComparableMountPath = resolveComparableLocalFolderRootPath(mount)
      // Ignore stale watcher events after mount topology drift; force a fast watcher
      // resync so we don't enqueue index jobs against a different mount target.
      if (mountedComparableMountPath !== expectedComparableMountPath) {
        stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false, clearRestartTimer: false })
        invalidateLocalFolderTreeCache(mountNotebookId)
        scheduleSyncLocalFolderWatchers(0)
        return
      }
      if (mount.status !== 'active') {
        const promoted = applyLocalFolderMountStatusTransition({
          updateLocalFolderMountStatus,
          notebookId: mountNotebookId,
          status: 'active',
          context: 'local-folder-watcher',
          enqueue: false,
          event: false,
        })
        if (!promoted.ok) {
          stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false })
          return
        }
      }
      invalidateLocalFolderTreeCache(mountNotebookId)
      const warmupUntilMs = localFolderWatcherEventWarmupUntilMsByNotebook.get(mountNotebookId) || 0
      if (warmupUntilMs > Date.now()) {
        if (!hasPendingFullIndexSyncForNotebook(mountNotebookId)) {
          scheduleLocalFolderWatchEvent({
            notebook_id: mountNotebookId,
            status: 'active',
            reason: 'content_changed',
            changed_relative_path: null,
          })
          enqueueLocalNotebookIndexSync(mountNotebookId, {
            full: true,
            changedRelativePath: null,
          })
        }
        return
      }
      const changedRelativePath = resolveWatchChangedRelativePath(rootPath, change.absolutePath)
      // Skip hidden files entirely (e.g. atomic-write temp files like .file.tmp-xxx).
      // The subsequent rename event for the actual file will trigger the real sync.
      if (changedRelativePath && isHiddenRelativePath(changedRelativePath)) return
      // Only file-level markdown/txt changes should run incremental index sync.
      // Directory/non-note events must trigger a full convergence refresh.
      const indexSyncRelativePath = resolveIndexSyncRelativePath(changedRelativePath)
      scheduleLocalFolderWatchEvent({
        notebook_id: mountNotebookId,
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: indexSyncRelativePath,
      })
      enqueueLocalNotebookIndexSync(mountNotebookId, {
        full: !indexSyncRelativePath,
        changedRelativePath: indexSyncRelativePath,
      })
    })

    watcher.on('error', (error) => {
      if (isRecoverableWatchError(error)) {
        stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false, clearRestartTimer: false })
        scheduleWatcherRescanRecovery(mountNotebookId)
        return
      }

      const nextStatus = resolveWatcherUnavailableStatus(mountNotebookId, error)
      if (!nextStatus) {
        console.error(
          `[local-folder-watcher] failed with non-fs watcher error: notebook=${mountNotebookId}`,
          error
        )
        stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false, clearRestartTimer: false })
        scheduleWatcherRescanRecovery(mountNotebookId)
        return
      }

      invalidateLocalFolderTreeCache(mountNotebookId)
      const updated = applyLocalFolderMountStatusTransition({
        updateLocalFolderMountStatus,
        notebookId: mountNotebookId,
        status: nextStatus,
        context: 'local-folder-watcher',
        enqueueLocalNotebookIndexSync,
        scheduleLocalFolderWatchEvent,
        enqueue: { full: true },
        event: {
          reason: 'status_changed',
          changed_relative_path: null,
        },
      })
      stopLocalFolderWatcher(mountNotebookId, { clearPendingEvent: false })
      if (!updated.ok) return
    })

    localFolderWatchers.set(mountNotebookId, watcher)
    localFolderWatcherComparableMountPathByNotebook.set(mountNotebookId, expectedComparableMountPath)
    const warmupMs = resolveLocalFolderWatcherEventWarmupMs()
    if (warmupMs > 0) {
      localFolderWatcherEventWarmupUntilMsByNotebook.set(mountNotebookId, Date.now() + warmupMs)
    } else {
      localFolderWatcherEventWarmupUntilMsByNotebook.delete(mountNotebookId)
    }
    clearLocalFolderWatcherRestartTimer(mountNotebookId)
  } catch (error) {
    if (isRecoverableWatchError(error)) {
      scheduleWatcherRescanRecovery(mountNotebookId)
      return
    }

    const nextStatus = resolveWatcherUnavailableStatus(mountNotebookId, error)
    if (!nextStatus) {
      console.error(
        `[local-folder-watcher] failed to bootstrap watcher with non-fs error: notebook=${mountNotebookId}`,
        error
      )
      scheduleWatcherRescanRecovery(mountNotebookId)
      return
    }

    const updated = applyLocalFolderMountStatusTransition({
      updateLocalFolderMountStatus,
      notebookId: mountNotebookId,
      status: nextStatus,
      context: 'local-folder-watcher',
      enqueueLocalNotebookIndexSync,
      scheduleLocalFolderWatchEvent,
      enqueue: { full: true },
      event: {
        reason: 'status_changed',
        changed_relative_path: null,
      },
    })
    invalidateLocalFolderTreeCache(mountNotebookId)
    if (!updated.ok) return
  }
}

function syncLocalFolderWatchersNow(): void {
  const mounts = getLocalFolderMounts()
  const activeNotebookIds = new Set(mounts.map((mount) => mount.notebook.id))

  for (const notebookId of Array.from(localFolderWatchers.keys())) {
    if (!activeNotebookIds.has(notebookId)) {
      stopLocalFolderWatcher(notebookId)
      invalidateLocalFolderTreeCache(notebookId)
      deleteWatchSequence(notebookId)
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

  for (const mount of mounts) {
    if (mount.mount.status !== 'active') {
      stopLocalFolderWatcher(mount.notebook.id)
      // Keep tree cache strictly aligned with persisted mount availability.
      // Non-active mounts should never retain a readable tree snapshot.
      invalidateLocalFolderTreeCache(mount.notebook.id)
      continue
    }
    const comparableMountPath = resolveComparableLocalFolderMountPath(mount.mount)
    let hadWatcher = localFolderWatchers.has(mount.notebook.id)
    if (hadWatcher) {
      const watchedComparableMountPath = localFolderWatcherComparableMountPathByNotebook.get(mount.notebook.id)
      if (watchedComparableMountPath !== comparableMountPath) {
        stopLocalFolderWatcher(mount.notebook.id, { clearPendingEvent: false, clearRestartTimer: false })
        hadWatcher = false
      }
    }
    ensureLocalFolderWatcher(
      mount.notebook.id,
      mount.mount.root_path,
      resolveLocalFolderCanonicalOrRootPath(mount.mount)
    )
    const hasWatcherNow = localFolderWatchers.has(mount.notebook.id)
    if (!hadWatcher && hasWatcherNow && !hasPendingFullIndexSyncForNotebook(mount.notebook.id)) {
      enqueueLocalNotebookIndexSync(mount.notebook.id, { full: true })
    }
  }
}

export function syncLocalFolderWatchers(): void {
  clearScheduledLocalFolderWatchersSync()
  syncLocalFolderWatchersNow()
}

export function scheduleSyncLocalFolderWatchers(delayMs: number = LOCAL_FOLDER_WATCHER_SYNC_DEBOUNCE_MS): void {
  clearScheduledLocalFolderWatchersSync()
  const normalizedDelayMs = Math.max(0, Math.floor(delayMs))
  localFolderWatchersSyncTimer = setTimeout(() => {
    localFolderWatchersSyncTimer = null
    syncLocalFolderWatchersNow()
  }, normalizedDelayMs)
}
