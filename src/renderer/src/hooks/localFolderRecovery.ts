import type { LocalFolderTreeResult, NotebookStatus } from '../types/note'

interface ConvergeRecoveredLocalFolderInput {
  notebookId: string
  refreshLocalFolderTree: (notebookId: string) => Promise<LocalFolderTreeResult | null>
  refreshLocalFolderStatuses: () => Promise<void> | void
  setLocalFolderStatuses: (
    updater: (prev: Record<string, NotebookStatus>) => Record<string, NotebookStatus>
  ) => void
  refreshOpenLocalFileFromDisk: () => Promise<void>
  notifyRecovered: () => void
  notifyRecoverFailed: () => void
  log?: (message: string, ...args: unknown[]) => void
}

export async function convergeRecoveredLocalFolder(
  input: ConvergeRecoveredLocalFolderInput
): Promise<boolean> {
  const {
    notebookId,
    refreshLocalFolderTree,
    refreshLocalFolderStatuses,
    setLocalFolderStatuses,
    refreshOpenLocalFileFromDisk,
    notifyRecovered,
    notifyRecoverFailed,
    log = console.error,
  } = input

  let tree: LocalFolderTreeResult | null = null
  try {
    tree = await refreshLocalFolderTree(notebookId)
  } catch (error) {
    log('[local-folder] failed to refresh tree during relink convergence:', error)
  }
  if (!tree) {
    try {
      await Promise.resolve(refreshLocalFolderStatuses())
    } catch (error) {
      log(
        '[local-folder] failed to refresh mount statuses after relink tree refresh miss:',
        error
      )
    }
    notifyRecoverFailed()
    return false
  }

  setLocalFolderStatuses((prev) => {
    if (prev[notebookId] === 'active') return prev
    return { ...prev, [notebookId]: 'active' }
  })

  try {
    await refreshOpenLocalFileFromDisk()
  } catch (error) {
    log('[local-folder] failed to refresh open local file from disk after relink:', error)
  }

  notifyRecovered()
  return true
}
