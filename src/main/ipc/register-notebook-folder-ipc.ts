import type { IpcMain } from 'electron'
import type {
  NotebookFolderCreateInput,
  NotebookFolderCreateResponse,
  NotebookFolderRenameInput,
  NotebookFolderRenameResponse,
  NotebookFolderDeleteInput,
  NotebookFolderDeleteResponse,
  NotebookFolder,
  Result,
} from '../../shared/types'
import {
  normalizeInternalFolderPath,
  getInternalFolderDepth,
  isValidInternalFolderName,
  composeInternalFolderPath,
  getInternalFolderParentPath,
  resolveInternalNotebook,
  INTERNAL_FOLDER_MAX_DEPTH,
} from '../internal-folder-path'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

export interface NotebookFolderIpcDeps {
  getNotebookFolders: (notebookId?: string) => NotebookFolder[]
  hasNotebookFolderPathReference: (input: { notebook_id: string; folder_path: string }) => boolean
  createNotebookFolderEntry: (input: { notebook_id: string; folder_path: string }) => Result<NotebookFolder, 'already_exists'>
  renameNotebookFolderEntry: (input: {
    notebook_id: string
    folder_path: string
    next_folder_path: string
  }) => Result<void, 'not_found' | 'conflict'>
  deleteNotebookFolderEntry: (input: {
    notebook_id: string
    folder_path: string
  }) => Result<{ deletedNoteIds: string[] }, 'not_found'>
  deleteNoteIndex: (noteId: string) => void
}

export function registerNotebookFolderIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: NotebookFolderIpcDeps
): void {
  ipcMainLike.handle('notebookFolder:list', createSafeHandler('notebookFolder:list', (_, notebookId?: string) => {
    const normalizedNotebookId = typeof notebookId === 'string' ? notebookId.trim() : ''
    return deps.getNotebookFolders(normalizedNotebookId || undefined)
  }))

  ipcMainLike.handle('notebookFolder:create', createSafeHandler('notebookFolder:create', (_, input: NotebookFolderCreateInput): NotebookFolderCreateResponse => {
    const notebookId = input?.notebook_id?.trim() || ''
    if (!notebookId) {
      return { success: false, errorCode: 'NOTEBOOK_NOT_FOUND' }
    }

    const notebookCheck = resolveInternalNotebook(notebookId)
    if (!notebookCheck.ok) {
      return { success: false, errorCode: notebookCheck.errorCode }
    }

    const folderName = input?.folder_name?.trim() || ''
    if (!isValidInternalFolderName(folderName)) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' }
    }

    const normalizedParentPath = normalizeInternalFolderPath(input.parent_folder_path)
    if (input.parent_folder_path && !normalizedParentPath) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }
    if (getInternalFolderDepth(normalizedParentPath) >= INTERNAL_FOLDER_MAX_DEPTH) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_DEPTH_LIMIT' }
    }

    const nextFolderPath = normalizeInternalFolderPath(
      composeInternalFolderPath(normalizedParentPath, folderName)
    )
    if (!nextFolderPath) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' }
    }
    if (getInternalFolderDepth(nextFolderPath) > INTERNAL_FOLDER_MAX_DEPTH) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_DEPTH_LIMIT' }
    }

    if (normalizedParentPath) {
      const parentExists = deps.hasNotebookFolderPathReference({
        notebook_id: notebookId,
        folder_path: normalizedParentPath,
      })
      if (!parentExists) {
        return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
      }
    }

    const created = deps.createNotebookFolderEntry({
      notebook_id: notebookId,
      folder_path: nextFolderPath,
    })
    if (!created.ok) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_ALREADY_EXISTS' }
    }

    return {
      success: true,
      result: {
        folder_path: created.value.folder_path,
      },
    }
  }))

  ipcMainLike.handle('notebookFolder:rename', createSafeHandler('notebookFolder:rename', (_, input: NotebookFolderRenameInput): NotebookFolderRenameResponse => {
    const notebookId = input?.notebook_id?.trim() || ''
    if (!notebookId) {
      return { success: false, errorCode: 'NOTEBOOK_NOT_FOUND' }
    }

    const notebookCheck = resolveInternalNotebook(notebookId)
    if (!notebookCheck.ok) {
      return { success: false, errorCode: notebookCheck.errorCode }
    }

    const currentFolderPath = normalizeInternalFolderPath(input?.folder_path)
    if (!currentFolderPath) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }

    const nextName = input?.new_name?.trim() || ''
    if (!isValidInternalFolderName(nextName)) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' }
    }

    const parentFolderPath = getInternalFolderParentPath(currentFolderPath)
    const nextFolderPath = normalizeInternalFolderPath(
      composeInternalFolderPath(parentFolderPath, nextName)
    )
    if (!nextFolderPath) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' }
    }
    if (getInternalFolderDepth(nextFolderPath) > INTERNAL_FOLDER_MAX_DEPTH) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_DEPTH_LIMIT' }
    }
    if (nextFolderPath === currentFolderPath) {
      return {
        success: true,
        result: { folder_path: currentFolderPath },
      }
    }

    const renamed = deps.renameNotebookFolderEntry({
      notebook_id: notebookId,
      folder_path: currentFolderPath,
      next_folder_path: nextFolderPath,
    })
    if (!renamed.ok) {
      return {
        success: false,
        errorCode: renamed.error === 'conflict'
          ? 'NOTEBOOK_FOLDER_ALREADY_EXISTS'
          : 'NOTEBOOK_FOLDER_NOT_FOUND',
      }
    }

    return {
      success: true,
      result: { folder_path: nextFolderPath },
    }
  }))

  ipcMainLike.handle('notebookFolder:delete', createSafeHandler('notebookFolder:delete', (_, input: NotebookFolderDeleteInput): NotebookFolderDeleteResponse => {
    const notebookId = input?.notebook_id?.trim() || ''
    if (!notebookId) {
      return { success: false, errorCode: 'NOTEBOOK_NOT_FOUND' }
    }

    const notebookCheck = resolveInternalNotebook(notebookId)
    if (!notebookCheck.ok) {
      return { success: false, errorCode: notebookCheck.errorCode }
    }

    const folderPath = normalizeInternalFolderPath(input?.folder_path)
    if (!folderPath) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }

    const deleted = deps.deleteNotebookFolderEntry({
      notebook_id: notebookId,
      folder_path: folderPath,
    })
    if (!deleted.ok) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }

    deleted.value.deletedNoteIds.forEach((noteId) => {
      deps.deleteNoteIndex(noteId)
    })

    return {
      success: true,
      result: {
        deleted_note_ids: deleted.value.deletedNoteIds,
      },
    }
  }))
}
