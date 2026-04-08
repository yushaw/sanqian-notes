import type { IpcMain } from 'electron'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

interface AttachmentSelectFilesOptions {
  filters?: Array<{ name: string; extensions: string[] }>
  multiple?: boolean
}

const ATTACHMENT_MAX_PATH_LENGTH = 4096
const ATTACHMENT_MAX_NAME_LENGTH = 255
const ATTACHMENT_SELECT_FILES_MAX_FILTERS = 32
const ATTACHMENT_SELECT_FILES_MAX_FILTER_NAME_LENGTH = 128
const ATTACHMENT_SELECT_FILES_MAX_FILTER_EXTENSIONS = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRequiredStringInput(
  input: unknown,
  options?: { maxLength?: number }
): string | null {
  if (typeof input !== 'string') return null
  if (!input.trim()) return null
  if (input.includes('\0')) return null
  if (typeof options?.maxLength === 'number' && input.length > options.maxLength) return null
  return input
}

function parseOptionalAttachmentNameInput(input: unknown): string | undefined | null {
  if (input === undefined) return undefined
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (input.length > ATTACHMENT_MAX_NAME_LENGTH) return null
  return input
}

const ATTACHMENT_EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/i

function parseAttachmentExtensionInput(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const withoutDot = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed
  if (!ATTACHMENT_EXTENSION_PATTERN.test(withoutDot)) return null
  return withoutDot.toLowerCase()
}

function parseAttachmentFilterExtensionInput(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed === '*') return trimmed
  const withoutDot = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed
  if (!ATTACHMENT_EXTENSION_PATTERN.test(withoutDot)) return null
  return withoutDot.toLowerCase()
}

function parseBufferInput(input: unknown): Buffer | null {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  return null
}

function parseAttachmentSelectFilesOptionsInput(input: unknown): AttachmentSelectFilesOptions | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null

  if (input.multiple !== undefined && typeof input.multiple !== 'boolean') return null
  let filters: Array<{ name: string; extensions: string[] }> | undefined
  if (input.filters !== undefined) {
    if (!Array.isArray(input.filters)) return null
    if (input.filters.length > ATTACHMENT_SELECT_FILES_MAX_FILTERS) return null
    filters = []
    for (const filterInput of input.filters) {
      if (!isRecord(filterInput) || Array.isArray(filterInput)) return null
      const name = parseRequiredStringInput(filterInput.name, { maxLength: ATTACHMENT_SELECT_FILES_MAX_FILTER_NAME_LENGTH })
      if (!name || !Array.isArray(filterInput.extensions)) return null
      if (
        filterInput.extensions.length === 0
        || filterInput.extensions.length > ATTACHMENT_SELECT_FILES_MAX_FILTER_EXTENSIONS
      ) {
        return null
      }
      const extensions: string[] = []
      for (const extInput of filterInput.extensions) {
        const ext = parseAttachmentFilterExtensionInput(extInput)
        if (!ext) return null
        extensions.push(ext)
      }
      filters.push({ name, extensions })
    }
  }

  return {
    filters,
    multiple: typeof input.multiple === 'boolean' ? input.multiple : undefined,
  }
}

export interface AttachmentIpcDeps {
  saveAttachment: (filePath: string) => Promise<unknown>
  saveAttachmentBuffer: (buffer: Buffer, ext: string, name?: string) => Promise<unknown>
  deleteAttachment: (relativePath: string) => Promise<boolean>
  openAttachment: (relativePath: string) => Promise<void>
  showInFolder: (relativePath: string) => void
  selectFiles: (options?: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean }) => Promise<string[] | null>
  selectImages: () => Promise<string[] | null>
  getFullPath: (relativePath: string) => string
  attachmentExists: (relativePath: string) => Promise<boolean>
  getAllAttachments: () => Promise<string[]>
  getUsedAttachmentPaths: () => string[]
  cleanupOrphanAttachments: (usedPaths: string[]) => Promise<number>
}

export function registerAttachmentIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: AttachmentIpcDeps
): void {
  ipcMainLike.handle('attachment:save', createSafeHandler('attachment:save', (_, filePathInput: unknown) => {
    const filePath = parseRequiredStringInput(filePathInput, { maxLength: ATTACHMENT_MAX_PATH_LENGTH })
    if (!filePath) {
      throw new Error('attachment:save filePath is invalid')
    }
    return deps.saveAttachment(filePath)
  }))
  ipcMainLike.handle('attachment:saveBuffer', createSafeHandler('attachment:saveBuffer', (_, bufferInput: unknown, extInput: unknown, nameInput?: unknown) => {
    const buffer = parseBufferInput(bufferInput)
    const ext = parseAttachmentExtensionInput(extInput)
    const name = parseOptionalAttachmentNameInput(nameInput)
    if (!buffer || !ext || name === null) {
      throw new Error('attachment:saveBuffer payload is invalid')
    }
    return deps.saveAttachmentBuffer(buffer, ext, name)
  }))
  ipcMainLike.handle('attachment:delete', createSafeHandler('attachment:delete', (_, relativePathInput: unknown) => {
    const relativePath = parseRequiredStringInput(relativePathInput, { maxLength: ATTACHMENT_MAX_PATH_LENGTH })
    if (!relativePath) return false
    return deps.deleteAttachment(relativePath)
  }))
  ipcMainLike.handle('attachment:open', createSafeHandler('attachment:open', (_, relativePathInput: unknown) => {
    const relativePath = parseRequiredStringInput(relativePathInput, { maxLength: ATTACHMENT_MAX_PATH_LENGTH })
    if (!relativePath) return
    return deps.openAttachment(relativePath)
  }))
  ipcMainLike.handle('attachment:showInFolder', createSafeHandler('attachment:showInFolder', (_, relativePathInput: unknown) => {
    const relativePath = parseRequiredStringInput(relativePathInput, { maxLength: ATTACHMENT_MAX_PATH_LENGTH })
    if (!relativePath) return
    deps.showInFolder(relativePath)
  }))
  ipcMainLike.handle('attachment:selectFiles', createSafeHandler('attachment:selectFiles', (_, optionsInput?: unknown) => {
    const options = parseAttachmentSelectFilesOptionsInput(optionsInput)
    if (optionsInput !== undefined && options === null) {
      throw new Error('attachment:selectFiles options are invalid')
    }
    return deps.selectFiles(options ?? undefined)
  }))
  ipcMainLike.handle('attachment:selectImages', createSafeHandler('attachment:selectImages', () => deps.selectImages()))
  ipcMainLike.handle('attachment:getFullPath', createSafeHandler('attachment:getFullPath', (_, relativePathInput: unknown) => {
    const relativePath = parseRequiredStringInput(relativePathInput, { maxLength: ATTACHMENT_MAX_PATH_LENGTH })
    if (!relativePath) return ''
    return deps.getFullPath(relativePath)
  }))
  ipcMainLike.handle('attachment:exists', createSafeHandler('attachment:exists', (_, relativePathInput: unknown) => {
    const relativePath = parseRequiredStringInput(relativePathInput, { maxLength: ATTACHMENT_MAX_PATH_LENGTH })
    if (!relativePath) return false
    return deps.attachmentExists(relativePath)
  }))
  ipcMainLike.handle('attachment:getAll', createSafeHandler('attachment:getAll', () => deps.getAllAttachments()))
  ipcMainLike.handle('attachment:cleanup', createSafeHandler('attachment:cleanup', async () => {
    const usedPaths = deps.getUsedAttachmentPaths()
    return deps.cleanupOrphanAttachments(usedPaths)
  }))
}
