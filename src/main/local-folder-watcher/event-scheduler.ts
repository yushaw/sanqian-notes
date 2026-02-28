import type { WebContentsView } from 'electron'
import type { LocalFolderWatchEvent } from '../../shared/types'
import { createLocalFolderWatchScheduler } from '../local-folder-watch'

const LOCAL_FOLDER_WATCH_DEBOUNCE_MS = 350

type LocalFolderWatchEventPayload = Omit<LocalFolderWatchEvent, 'sequence' | 'changed_at_ms'>

let mainViewGetter: (() => WebContentsView | null) | null = null

const localFolderWatchSequences = new Map<string, number>()

function emitLocalFolderWatchEvent(event: LocalFolderWatchEvent): void {
  mainViewGetter?.()?.webContents.send('localFolder:changed', event)
}

function mergeLocalFolderWatchEventPayload(
  previous: LocalFolderWatchEventPayload,
  next: LocalFolderWatchEventPayload
): LocalFolderWatchEventPayload {
  const previousReason = previous.reason || 'content_changed'
  const nextReason = next.reason || 'content_changed'

  const mergedReason: LocalFolderWatchEventPayload['reason'] = (
    previousReason === 'rescan_required' || nextReason === 'rescan_required'
      ? 'rescan_required'
      : previousReason === 'status_changed' || nextReason === 'status_changed'
        ? 'status_changed'
        : 'content_changed'
  )

  let changedRelativePath: string | null = null
  if (mergedReason === 'content_changed') {
    const previousPath = previous.changed_relative_path ?? null
    const nextPath = next.changed_relative_path ?? null

    if (previousReason !== 'content_changed') {
      changedRelativePath = nextPath
    } else if (nextReason !== 'content_changed') {
      changedRelativePath = previousPath
    } else if (previousPath && nextPath && previousPath === nextPath) {
      changedRelativePath = previousPath
    } else {
      // Multiple files (or unknown path) changed within one debounce window.
      changedRelativePath = null
    }
  }

  return {
    notebook_id: next.notebook_id,
    status: next.status,
    reason: mergedReason,
    changed_relative_path: changedRelativePath,
  }
}

function nextLocalFolderWatchSequence(notebookId: string): number {
  const next = (localFolderWatchSequences.get(notebookId) || 0) + 1
  localFolderWatchSequences.set(notebookId, next)
  return next
}

const localFolderWatchEventScheduler = createLocalFolderWatchScheduler<LocalFolderWatchEventPayload>(
  (payload) => {
    emitLocalFolderWatchEvent({
      ...payload,
      sequence: nextLocalFolderWatchSequence(payload.notebook_id),
      changed_at_ms: Date.now(),
    })
  },
  LOCAL_FOLDER_WATCH_DEBOUNCE_MS,
  mergeLocalFolderWatchEventPayload
)

export function scheduleLocalFolderWatchEvent(event: LocalFolderWatchEventPayload): void {
  localFolderWatchEventScheduler.schedule(event)
}

export function clearWatchEventSchedule(notebookId: string): void {
  localFolderWatchEventScheduler.clear(notebookId)
}

export function clearAllWatchEventSchedules(): void {
  localFolderWatchEventScheduler.clearAll()
}

export function deleteWatchSequence(notebookId: string): void {
  localFolderWatchSequences.delete(notebookId)
}

export function clearAllWatchSequences(): void {
  localFolderWatchSequences.clear()
}

export function initWatchEventScheduler(deps: { getMainView: () => WebContentsView | null }): void {
  mainViewGetter = deps.getMainView
}
