import type {
  LocalFolderMountStatusPersistResult,
  LocalFolderWatchEvent,
  NotebookStatus,
} from '../shared/types'
import {
  type LocalFolderMountStatusSafeUpdateResult,
  safeUpdateLocalFolderMountStatus,
} from './local-folder-mount-status'

interface LocalFolderStatusChangedEvent {
  notebook_id: string
  status: NotebookStatus
  reason?: LocalFolderWatchEvent['reason']
  changed_relative_path: string | null
}

interface LocalFolderMountStatusTransitionInput {
  updateLocalFolderMountStatus: (
    notebookId: string,
    status: NotebookStatus
  ) => LocalFolderMountStatusPersistResult
  notebookId: string
  status: NotebookStatus
  context: string
  enqueueLocalNotebookIndexSync?: (
    notebookId: string,
    options: { full?: boolean; immediate?: boolean; changedRelativePath?: string }
  ) => void
  scheduleLocalFolderWatchEvent?: (event: LocalFolderStatusChangedEvent) => void
  enqueue?: false | { full?: boolean; immediate?: boolean; changedRelativePath?: string }
  event?: false | {
    reason?: LocalFolderWatchEvent['reason']
    changed_relative_path?: string | null
  }
  log?: (message: string, ...args: unknown[]) => void
}

export interface LocalFolderMountStatusTransitionResult {
  ok: boolean
  changed: boolean
  updateResult: LocalFolderMountStatusSafeUpdateResult
}

export function applyLocalFolderMountStatusTransition(
  input: LocalFolderMountStatusTransitionInput
): LocalFolderMountStatusTransitionResult {
  const log = input.log || console.error
  const updateResult = safeUpdateLocalFolderMountStatus({
    updateLocalFolderMountStatus: input.updateLocalFolderMountStatus,
    notebookId: input.notebookId,
    status: input.status,
    context: input.context,
    log,
  })

  if (updateResult === 'not_found' || updateResult === 'conflict' || updateResult === 'error') {
    return { ok: false, changed: false, updateResult }
  }

  if (updateResult === 'no_change') {
    return { ok: true, changed: false, updateResult }
  }

  if (input.enqueue !== false && input.enqueueLocalNotebookIndexSync) {
    const enqueueOptions = input.enqueue || {}
    try {
      input.enqueueLocalNotebookIndexSync(input.notebookId, {
        full: true,
        ...enqueueOptions,
      })
    } catch (error) {
      log(
        `[${input.context}] failed to enqueue local notebook index sync after mount status transition: notebook=${input.notebookId}, status=${input.status}`,
        error
      )
    }
  }

  if (input.event !== false && input.scheduleLocalFolderWatchEvent) {
    const eventOptions = input.event || {}
    try {
      input.scheduleLocalFolderWatchEvent({
        notebook_id: input.notebookId,
        status: input.status,
        reason: eventOptions.reason || 'status_changed',
        changed_relative_path: eventOptions.changed_relative_path ?? null,
      })
    } catch (error) {
      log(
        `[${input.context}] failed to schedule local-folder watch event after mount status transition: notebook=${input.notebookId}, status=${input.status}`,
        error
      )
    }
  }

  return { ok: true, changed: true, updateResult }
}
