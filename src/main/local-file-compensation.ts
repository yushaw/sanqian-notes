import { shell } from 'electron'
import { existsSync } from 'fs'
import type {
  LocalFolderFileErrorCode,
  LocalFolderNotebookMount,
} from '../shared/types'
import { resolveLocalFolderDeleteTarget } from './local-folder'

export interface LocalFileRef {
  notebookId: string
  relativePath: string
}

export interface TrashLocalFileOptions {
  notFoundIsSuccess?: boolean
}

export type TrashLocalFileResult =
  | { ok: true; state: 'trashed' | 'already-missing' | 'already-trashed' }
  | { ok: false; reason: 'resolve_failed'; errorCode: LocalFolderFileErrorCode }
  | { ok: false; reason: 'trash_failed'; absolutePath: string }

export interface TrashLocalFileDeps {
  resolveDeleteTarget: typeof resolveLocalFolderDeleteTarget
  trashItem: (absolutePath: string) => Promise<void>
  existsSync: (absolutePath: string) => boolean
}

const defaultDeps: TrashLocalFileDeps = {
  resolveDeleteTarget: resolveLocalFolderDeleteTarget,
  trashItem: async (absolutePath: string) => shell.trashItem(absolutePath),
  existsSync,
}

function isNotFoundDeleteError(errorCode: LocalFolderFileErrorCode): boolean {
  return errorCode === 'LOCAL_FILE_NOT_FOUND' || errorCode === 'LOCAL_FILE_NOT_A_FILE'
}

export async function trashLocalFile(
  mount: LocalFolderNotebookMount,
  file: LocalFileRef,
  options?: TrashLocalFileOptions,
  deps: TrashLocalFileDeps = defaultDeps
): Promise<TrashLocalFileResult> {
  const deleteTarget = deps.resolveDeleteTarget(mount, {
    notebook_id: file.notebookId,
    relative_path: file.relativePath,
    kind: 'file',
  })
  if (!deleteTarget.success) {
    if (options?.notFoundIsSuccess && isNotFoundDeleteError(deleteTarget.errorCode)) {
      return { ok: true, state: 'already-missing' }
    }
    return {
      ok: false,
      reason: 'resolve_failed',
      errorCode: deleteTarget.errorCode,
    }
  }

  const absolutePath = deleteTarget.result.absolute_path
  try {
    await deps.trashItem(absolutePath)
    return { ok: true, state: 'trashed' }
  } catch {
    if (!deps.existsSync(absolutePath)) {
      return { ok: true, state: 'already-trashed' }
    }
    return {
      ok: false,
      reason: 'trash_failed',
      absolutePath,
    }
  }
}

export async function rollbackLocalFile(
  mount: LocalFolderNotebookMount,
  file: LocalFileRef,
  deps?: TrashLocalFileDeps
): Promise<boolean> {
  const result = await trashLocalFile(
    mount,
    file,
    { notFoundIsSuccess: true },
    deps
  )
  return result.ok
}
