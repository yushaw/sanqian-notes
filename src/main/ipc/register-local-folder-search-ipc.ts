import type { IpcMain } from 'electron'
import type {
  LocalFolderSearchInput,
  LocalFolderSearchResponse,
} from '../../shared/types'
import type { LocalFolderSearchHandlerDependencies } from '../local-folder-search-ipc'
import { createLocalFolderSearchHandler } from '../local-folder-search-ipc'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

export function registerLocalFolderSearchIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: LocalFolderSearchHandlerDependencies
): void {
  const handleLocalFolderSearch = createLocalFolderSearchHandler(deps)
  ipcMainLike.handle(
    'localFolder:search',
    createSafeHandler('localFolder:search', async (_, input: LocalFolderSearchInput): Promise<LocalFolderSearchResponse> => {
      return handleLocalFolderSearch(input)
    })
  )
}
