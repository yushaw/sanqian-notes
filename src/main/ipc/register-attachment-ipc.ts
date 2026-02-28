import type { IpcMain } from 'electron'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

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
  ipcMainLike.handle('attachment:save', createSafeHandler('attachment:save', (_, filePath: string) => deps.saveAttachment(filePath)))
  ipcMainLike.handle('attachment:saveBuffer', createSafeHandler('attachment:saveBuffer', (_, buffer: Buffer, ext: string, name?: string) =>
    deps.saveAttachmentBuffer(buffer, ext, name)
  ))
  ipcMainLike.handle('attachment:delete', createSafeHandler('attachment:delete', (_, relativePath: string) => deps.deleteAttachment(relativePath)))
  ipcMainLike.handle('attachment:open', createSafeHandler('attachment:open', (_, relativePath: string) => deps.openAttachment(relativePath)))
  ipcMainLike.handle('attachment:showInFolder', createSafeHandler('attachment:showInFolder', (_, relativePath: string) => deps.showInFolder(relativePath)))
  ipcMainLike.handle('attachment:selectFiles', createSafeHandler('attachment:selectFiles', (_, options?: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean }) =>
    deps.selectFiles(options)
  ))
  ipcMainLike.handle('attachment:selectImages', createSafeHandler('attachment:selectImages', () => deps.selectImages()))
  ipcMainLike.handle('attachment:getFullPath', createSafeHandler('attachment:getFullPath', (_, relativePath: string) => deps.getFullPath(relativePath)))
  ipcMainLike.handle('attachment:exists', createSafeHandler('attachment:exists', (_, relativePath: string) => deps.attachmentExists(relativePath)))
  ipcMainLike.handle('attachment:getAll', createSafeHandler('attachment:getAll', () => deps.getAllAttachments()))
  ipcMainLike.handle('attachment:cleanup', createSafeHandler('attachment:cleanup', async () => {
    const usedPaths = deps.getUsedAttachmentPaths()
    return deps.cleanupOrphanAttachments(usedPaths)
  }))
}
