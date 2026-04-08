import type {
  LocalFolderMountStatusPersistResult,
  NotebookStatus,
} from '../shared/types'

export type LocalFolderMountStatusSafeUpdateResult =
  | LocalFolderMountStatusPersistResult
  | 'error'

interface SafeUpdateLocalFolderMountStatusInput {
  updateLocalFolderMountStatus: (
    notebookId: string,
    status: NotebookStatus
  ) => LocalFolderMountStatusPersistResult
  notebookId: string
  status: NotebookStatus
  context: string
  log?: (message: string, ...args: unknown[]) => void
}

export function safeUpdateLocalFolderMountStatus(
  input: SafeUpdateLocalFolderMountStatusInput
): LocalFolderMountStatusSafeUpdateResult {
  const {
    updateLocalFolderMountStatus,
    notebookId,
    status,
    context,
    log = console.error,
  } = input

  try {
    return updateLocalFolderMountStatus(notebookId, status)
  } catch (error) {
    log(
      `[${context}] failed to persist local-folder mount status: notebook=${notebookId}, status=${status}`,
      error
    )
    return 'error'
  }
}
