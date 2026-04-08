import type { IpcMain } from 'electron'
import type {
  LocalFolderSearchResponse,
} from '../../shared/types'
import type { LocalFolderSearchHandlerDependencies } from '../local-folder-search-ipc'
import { createLocalFolderSearchHandler } from '../local-folder-search-ipc'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

export function registerLocalFolderSearchIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: LocalFolderSearchHandlerDependencies
): void {
  const handleLocalFolderSearch = createLocalFolderSearchHandler(deps)
  ipcMainLike.handle(
    'localFolder:search',
    async (_, input: unknown): Promise<LocalFolderSearchResponse> => {
      try {
        return await handleLocalFolderSearch(input)
      } catch (error) {
        console.error('[localFolder:search] ipc handler failed:', error)
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }
    }
  )
}
