import type { IpcMain } from 'electron'
import type {
  InternalNotebookInput,
  InternalNotebookUpdateInput,
  Notebook,
  NotebookDeleteInternalResponse,
} from '../../shared/types'
import { parseRequiredNotebookIdInput } from '../notebook-id'
import { emitNotebookDeleteAudit } from '../notebook-audit'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

const NOTEBOOK_ID_MAX_LENGTH = 1024
const NOTEBOOK_NAME_MAX_LENGTH = 200
const NOTEBOOK_ICON_MAX_LENGTH = 64
const NOTEBOOK_REORDER_MAX_ITEMS = 10000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function parseRequiredNotebookIdWithLengthInput(input: unknown): string | null {
  const notebookId = parseRequiredNotebookIdInput(input)
  if (!notebookId) return null
  if (notebookId.length > NOTEBOOK_ID_MAX_LENGTH) return null
  return notebookId
}

function parseNotebookCreateInput(input: unknown): InternalNotebookInput {
  if (!isRecord(input)) {
    throw new Error('notebook:add payload must be an object')
  }

  const sourceType = input.source_type
  if (sourceType !== undefined && sourceType !== 'internal') {
    throw new Error(`notebook:add does not support source_type=${sourceType}`)
  }

  if (typeof input.name !== 'string') {
    throw new Error('notebook:add name must be a string')
  }
  const parsedName = parseBoundedString(input.name, {
    maxLength: NOTEBOOK_NAME_MAX_LENGTH,
    trim: true,
    allowEmpty: false,
  })
  if (!parsedName) {
    throw new Error('notebook:add name must not be empty')
  }
  const name = parsedName

  let icon: string | undefined
  if (input.icon !== undefined && typeof input.icon !== 'string') {
    throw new Error('notebook:add icon must be a string')
  }
  if (typeof input.icon === 'string') {
    const parsedIcon = parseBoundedString(input.icon, { maxLength: NOTEBOOK_ICON_MAX_LENGTH })
    if (!parsedIcon) {
      throw new Error(`notebook:add icon exceeds max length ${NOTEBOOK_ICON_MAX_LENGTH}`)
    }
    icon = parsedIcon
  }

  return {
    name,
    icon,
  }
}

function parseNotebookUpdateInput(input: unknown): InternalNotebookUpdateInput {
  if (!isRecord(input)) {
    throw new Error('notebook:update payload must be an object')
  }

  const sourceType = input.source_type
  if (sourceType !== undefined && sourceType !== 'internal') {
    throw new Error(`notebook:update does not support source_type=${sourceType}`)
  }

  let name: string | undefined
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') {
      throw new Error('notebook:update name must be a string')
    }
    const parsedName = parseBoundedString(input.name, {
      maxLength: NOTEBOOK_NAME_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!parsedName) {
      throw new Error('notebook:update name must not be empty')
    }
    name = parsedName
  }

  let icon: string | undefined
  if (input.icon !== undefined) {
    if (typeof input.icon !== 'string') {
      throw new Error('notebook:update icon must be a string')
    }
    const parsedIcon = parseBoundedString(input.icon, { maxLength: NOTEBOOK_ICON_MAX_LENGTH })
    if (!parsedIcon) {
      throw new Error(`notebook:update icon exceeds max length ${NOTEBOOK_ICON_MAX_LENGTH}`)
    }
    icon = parsedIcon
  }

  return {
    name,
    icon,
  }
}

function parseNotebookDeleteInput(input: unknown): { notebook_id: string } {
  if (!isRecord(input)) {
    throw new Error('notebook:deleteInternalWithNotes payload must be an object')
  }
  const notebookId = parseRequiredNotebookIdWithLengthInput(input.notebook_id)
  if (!notebookId) {
    throw new Error('notebook:deleteInternalWithNotes notebook_id must be a non-empty string')
  }
  return { notebook_id: notebookId }
}

function parseNotebookReorderInput(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('notebook:reorder payload must be an array')
  }
  if (input.length > NOTEBOOK_REORDER_MAX_ITEMS) {
    throw new Error(`notebook:reorder payload exceeds max length ${NOTEBOOK_REORDER_MAX_ITEMS}`)
  }
  const seenNotebookIds = new Set<string>()
  const orderedIds: string[] = []
  for (const notebookIdInput of input) {
    const notebookId = parseRequiredNotebookIdWithLengthInput(notebookIdInput)
    if (!notebookId) {
      throw new Error('notebook:reorder notebook ids must be non-empty strings')
    }
    if (seenNotebookIds.has(notebookId)) {
      throw new Error('notebook:reorder notebook ids must be unique')
    }
    seenNotebookIds.add(notebookId)
    orderedIds.push(notebookId)
  }
  return orderedIds
}

export interface NotebookIpcDependencies {
  getNotebooks: () => Notebook[]
  addNotebook: (notebook: InternalNotebookInput) => Notebook
  updateNotebook: (id: string, updates: InternalNotebookUpdateInput) => Notebook | null
  deleteInternalNotebookWithNotes: (input: {
    notebook_id: string
  }) => NotebookDeleteInternalResponse
  reorderNotebooks: (orderedIds: string[]) => void
}

export function registerNotebookIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: NotebookIpcDependencies
): void {
  ipcMainLike.handle('notebook:getAll', createSafeHandler('notebook:getAll', () => deps.getNotebooks()))
  ipcMainLike.handle('notebook:add', createSafeHandler('notebook:add', (_, notebook: unknown) => {
    return deps.addNotebook(parseNotebookCreateInput(notebook))
  }))
  ipcMainLike.handle('notebook:update', createSafeHandler('notebook:update', (_, idInput: unknown, updates: unknown) => {
    const id = parseRequiredNotebookIdWithLengthInput(idInput)
    if (!id) {
      return null
    }
    return deps.updateNotebook(id, parseNotebookUpdateInput(updates))
  }))
  ipcMainLike.handle(
    'notebook:deleteInternalWithNotes',
    createSafeHandler(
      'notebook:deleteInternalWithNotes',
      (_, input: unknown) => {
        const parsedInput = parseNotebookDeleteInput(input)
        const startedAt = Date.now()
        try {
          const result = deps.deleteInternalNotebookWithNotes(parsedInput)
          if (!result.success) {
            emitNotebookDeleteAudit(console, {
              operation: 'internal_delete',
              notebookId: parsedInput.notebook_id,
              success: false,
              errorCode: result.errorCode,
              durationMs: Date.now() - startedAt,
            })
            return result
          }

          emitNotebookDeleteAudit(console, {
            operation: 'internal_delete',
            notebookId: parsedInput.notebook_id,
            success: true,
            deletedNoteCount: result.result.deleted_note_ids.length,
            durationMs: Date.now() - startedAt,
          })
          return result
        } catch (error) {
          emitNotebookDeleteAudit(console, {
            operation: 'internal_delete',
            notebookId: parsedInput.notebook_id,
            success: false,
            errorCode: 'handler_exception',
            durationMs: Date.now() - startedAt,
          })
          throw error
        }
      }
    )
  )
  ipcMainLike.handle(
    'notebook:reorder',
    createSafeHandler('notebook:reorder', (_, orderedIds: unknown) => deps.reorderNotebooks(parseNotebookReorderInput(orderedIds)))
  )
}
