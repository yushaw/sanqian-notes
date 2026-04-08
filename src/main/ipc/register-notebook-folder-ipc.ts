import type { IpcMain } from 'electron'
import type {
  NotebookFolderCreateResponse,
  NotebookFolderRenameResponse,
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
import { parseRequiredNotebookIdInput } from '../notebook-id'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>
const NOTEBOOK_FOLDER_NAME_MAX_LENGTH = 255
const NOTEBOOK_FOLDER_PATH_MAX_LENGTH = 4096
const INVALID_BOUNDED_STRING = Symbol('INVALID_BOUNDED_STRING')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBoundedString(
  input: unknown,
  options: { maxLength: number; trim?: boolean; allowEmpty?: boolean }
): string | null {
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (input.length > options.maxLength) return null
  const value = options.trim ? input.trim() : input
  if (options.allowEmpty === false && !value) return null
  return value
}

function parseOptionalNullableBoundedString(
  input: unknown,
  options: { maxLength: number; trim?: boolean; allowEmpty?: boolean }
): string | null | undefined | typeof INVALID_BOUNDED_STRING {
  if (input === undefined) return undefined
  if (input === null) return null
  const parsed = parseBoundedString(input, options)
  return parsed === null ? INVALID_BOUNDED_STRING : parsed
}

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
  deleteNoteIndexes?: (noteIds: readonly string[]) => number | void
}

export function registerNotebookFolderIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: NotebookFolderIpcDeps
): void {
  ipcMainLike.handle('notebookFolder:list', createSafeHandler('notebookFolder:list', (_, notebookIdInput?: unknown) => {
    if (notebookIdInput === undefined) {
      return deps.getNotebookFolders(undefined)
    }
    const notebookId = parseRequiredNotebookIdInput(notebookIdInput)
    if (!notebookId) {
      return []
    }
    return deps.getNotebookFolders(notebookId)
  }))

  ipcMainLike.handle('notebookFolder:create', createSafeHandler('notebookFolder:create', (_, input: unknown): NotebookFolderCreateResponse => {
    const payload = isRecord(input) ? input : {}
    const notebookId = parseRequiredNotebookIdInput(payload.notebook_id)
    if (!notebookId) {
      return { success: false, errorCode: 'NOTEBOOK_NOT_FOUND' }
    }

    const notebookCheck = resolveInternalNotebook(notebookId)
    if (!notebookCheck.ok) {
      return { success: false, errorCode: notebookCheck.errorCode }
    }

    const folderName = parseBoundedString(payload.folder_name, {
      maxLength: NOTEBOOK_FOLDER_NAME_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!folderName || !isValidInternalFolderName(folderName)) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_INVALID_NAME' }
    }

    const parentFolderPathInput = parseOptionalNullableBoundedString(
      payload.parent_folder_path,
      { maxLength: NOTEBOOK_FOLDER_PATH_MAX_LENGTH }
    )
    if (parentFolderPathInput === INVALID_BOUNDED_STRING) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }
    const normalizedParentPath = normalizeInternalFolderPath(parentFolderPathInput)
    if (typeof parentFolderPathInput === 'string' && parentFolderPathInput && !normalizedParentPath) {
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

  ipcMainLike.handle('notebookFolder:rename', createSafeHandler('notebookFolder:rename', (_, input: unknown): NotebookFolderRenameResponse => {
    const payload = isRecord(input) ? input : {}
    const notebookId = parseRequiredNotebookIdInput(payload.notebook_id)
    if (!notebookId) {
      return { success: false, errorCode: 'NOTEBOOK_NOT_FOUND' }
    }

    const notebookCheck = resolveInternalNotebook(notebookId)
    if (!notebookCheck.ok) {
      return { success: false, errorCode: notebookCheck.errorCode }
    }

    const currentFolderPathInput = parseBoundedString(payload.folder_path, {
      maxLength: NOTEBOOK_FOLDER_PATH_MAX_LENGTH,
      allowEmpty: false,
    })
    if (!currentFolderPathInput) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }
    const currentFolderPath = normalizeInternalFolderPath(currentFolderPathInput)
    if (!currentFolderPath) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }

    const nextName = parseBoundedString(payload.new_name, {
      maxLength: NOTEBOOK_FOLDER_NAME_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!nextName || !isValidInternalFolderName(nextName)) {
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

  ipcMainLike.handle('notebookFolder:delete', createSafeHandler('notebookFolder:delete', (_, input: unknown): NotebookFolderDeleteResponse => {
    const payload = isRecord(input) ? input : {}
    const notebookId = parseRequiredNotebookIdInput(payload.notebook_id)
    if (!notebookId) {
      return { success: false, errorCode: 'NOTEBOOK_NOT_FOUND' }
    }

    const notebookCheck = resolveInternalNotebook(notebookId)
    if (!notebookCheck.ok) {
      return { success: false, errorCode: notebookCheck.errorCode }
    }

    const folderPathInput = parseBoundedString(payload.folder_path, {
      maxLength: NOTEBOOK_FOLDER_PATH_MAX_LENGTH,
      allowEmpty: false,
    })
    if (!folderPathInput) {
      return { success: false, errorCode: 'NOTEBOOK_FOLDER_NOT_FOUND' }
    }
    const folderPath = normalizeInternalFolderPath(folderPathInput)
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

    const deletedNoteIds = deleted.value.deletedNoteIds
    if (deletedNoteIds.length > 1 && typeof deps.deleteNoteIndexes === 'function') {
      deps.deleteNoteIndexes(deletedNoteIds)
    } else {
      deletedNoteIds.forEach((noteId) => {
        deps.deleteNoteIndex(noteId)
      })
    }

    return {
      success: true,
      result: {
        deleted_note_ids: deletedNoteIds,
      },
    }
  }))
}
