import type { IpcMain } from 'electron'
import type { Notebook, NotebookInput } from '../../shared/types'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

export interface NotebookIpcDependencies {
  getNotebooks: () => Notebook[]
  addNotebook: (notebook: NotebookInput) => Notebook
  updateNotebook: (id: string, updates: Partial<NotebookInput>) => Notebook | null
  deleteNotebook: (id: string) => boolean
  reorderNotebooks: (orderedIds: string[]) => void
}

export function registerNotebookIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: NotebookIpcDependencies
): void {
  ipcMainLike.handle('notebook:getAll', createSafeHandler('notebook:getAll', () => deps.getNotebooks()))
  ipcMainLike.handle('notebook:add', createSafeHandler('notebook:add', (_, notebook: NotebookInput) => deps.addNotebook(notebook)))
  ipcMainLike.handle('notebook:update', createSafeHandler('notebook:update', (_, id: string, updates: Partial<NotebookInput>) => deps.updateNotebook(id, updates)))
  ipcMainLike.handle('notebook:delete', createSafeHandler('notebook:delete', (_, id: string) => deps.deleteNotebook(id)))
  ipcMainLike.handle('notebook:reorder', createSafeHandler('notebook:reorder', (_, orderedIds: string[]) => deps.reorderNotebooks(orderedIds)))
}
