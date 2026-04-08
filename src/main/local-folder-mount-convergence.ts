import type { NotebookStatus } from '../shared/types'

export type LocalFolderUnavailableStatus = Extract<NotebookStatus, 'missing' | 'permission_required'>

interface ResolvePersistedUnavailableMountStatusInput {
  getLocalFolderMountByNotebookId?: (
    notebookId: string
  ) => { root_path: string; status?: NotebookStatus } | null
  notebookId: string
  fallback: LocalFolderUnavailableStatus
  context: string
  log?: (message?: unknown, ...optionalParams: unknown[]) => void
}

export function resolvePersistedUnavailableMountStatus(
  input: ResolvePersistedUnavailableMountStatusInput
): LocalFolderUnavailableStatus {
  const {
    getLocalFolderMountByNotebookId,
    notebookId,
    fallback,
    context,
    log = console.error,
  } = input

  if (!getLocalFolderMountByNotebookId) return fallback

  try {
    const mount = getLocalFolderMountByNotebookId(notebookId)
    if (mount?.status === 'permission_required' || mount?.status === 'missing') {
      return mount.status
    }
  } catch (error) {
    log(
      `[${context}] failed to resolve latest mount status from storage: notebook=${notebookId}`,
      error
    )
  }

  return fallback
}
