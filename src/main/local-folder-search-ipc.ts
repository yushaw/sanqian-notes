import type {
  LocalFolderNotebookMount,
  LocalFolderSearchHit,
  LocalFolderSearchInput,
  LocalFolderSearchResponse,
  LocalFolderTreeResult,
  LocalFolderWatchEvent,
  NotebookStatus,
} from '../shared/types'
import { mapWithConcurrency } from './concurrency'
import { dedupeLocalFolderSearchHits, searchLocalFolderMountAsync } from './local-folder'
import { resolveSearchScope } from './search-scope'

export interface LocalFolderSearchHandlerDependencies {
  getLocalFolderMounts: () => LocalFolderNotebookMount[]
  getCachedLocalFolderTree: (notebookId: string, maxAgeMs: number) => LocalFolderTreeResult | null
  updateLocalFolderMountStatus: (notebookId: string, status: NotebookStatus) => void
  invalidateLocalFolderTreeCache: (notebookId: string) => void
  scheduleLocalFolderWatchEvent: (event: LocalFolderWatchEvent) => void
  resolveMountStatusFromFsError: (error: unknown) => NotebookStatus
  globalSearchConcurrency: number
  searchScanCacheTtlMs: number
  searchLocalFolderMount?: (
    mount: LocalFolderNotebookMount,
    query: string,
    folderRelativePath: string | null,
    scannedTree?: LocalFolderTreeResult
  ) => Promise<LocalFolderSearchHit[]>
  dedupeHits?: (hits: LocalFolderSearchHit[]) => LocalFolderSearchHit[]
}

function asScopeEntryId(input: LocalFolderSearchInput): 'global_search' | 'folder_search' {
  return input?.notebook_id ? 'folder_search' : 'global_search'
}

function mapMountStatusToSearchError(status: NotebookStatus): LocalFolderSearchResponse {
  if (status === 'permission_required') {
    return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
  }
  return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
}

function handleMountSearchFailure(
  deps: Pick<
    LocalFolderSearchHandlerDependencies,
    'resolveMountStatusFromFsError'
    | 'updateLocalFolderMountStatus'
    | 'invalidateLocalFolderTreeCache'
    | 'scheduleLocalFolderWatchEvent'
  >,
  mount: LocalFolderNotebookMount,
  error: unknown
): NotebookStatus {
  const nextStatus = deps.resolveMountStatusFromFsError(error)
  deps.updateLocalFolderMountStatus(mount.notebook.id, nextStatus)
  deps.invalidateLocalFolderTreeCache(mount.notebook.id)
  deps.scheduleLocalFolderWatchEvent({
    notebook_id: mount.notebook.id,
    status: nextStatus,
    reason: 'status_changed',
    changed_relative_path: null,
  })
  return nextStatus
}

export function createLocalFolderSearchHandler(deps: LocalFolderSearchHandlerDependencies) {
  const searchLocalFolderMount = deps.searchLocalFolderMount ?? searchLocalFolderMountAsync
  const dedupeHits = deps.dedupeHits ?? dedupeLocalFolderSearchHits

  return async (input: LocalFolderSearchInput): Promise<LocalFolderSearchResponse> => {
    const query = input?.query?.trim() || ''
    if (!query) {
      return { success: true, result: { hits: [] } }
    }

    const scope = resolveSearchScope({
      entryId: asScopeEntryId(input),
      notebookId: input?.notebook_id ?? null,
      folderRelativePath: input?.folder_relative_path ?? null,
    })
    if (!scope.success) {
      if (scope.errorCode === 'SEARCH_SCOPE_NOTEBOOK_REQUIRED') {
        return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
      }
      return { success: true, result: { hits: [] } }
    }

    const resolvedScope = scope.scope
    const allMounts = deps.getLocalFolderMounts()
    if (resolvedScope.kind !== 'global') {
      const mount = allMounts.find((item) => item.notebook.id === resolvedScope.notebookId)
      if (!mount) {
        return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
      }
      if (mount.mount.status === 'missing') {
        return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
      }
      if (mount.mount.status === 'permission_required') {
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }

      const folderRelativePath = resolvedScope.kind === 'current_folder_subtree'
        ? resolvedScope.folderRelativePath
        : null

      try {
        const scannedTree = deps.getCachedLocalFolderTree(
          mount.notebook.id,
          deps.searchScanCacheTtlMs
        ) ?? undefined
        const hits = await searchLocalFolderMount(
          mount,
          query,
          folderRelativePath,
          scannedTree
        )
        return { success: true, result: { hits: dedupeHits(hits) } }
      } catch (error) {
        const nextStatus = handleMountSearchFailure(deps, mount, error)
        return mapMountStatusToSearchError(nextStatus)
      }
    }

    const activeMounts = allMounts.filter((mount) => mount.mount.status === 'active')
    const hitGroups = await mapWithConcurrency(
      activeMounts,
      deps.globalSearchConcurrency,
      async (mount): Promise<LocalFolderSearchHit[]> => {
        try {
          const scannedTree = deps.getCachedLocalFolderTree(
            mount.notebook.id,
            deps.searchScanCacheTtlMs
          ) ?? undefined
          return await searchLocalFolderMount(mount, query, null, scannedTree)
        } catch (error) {
          handleMountSearchFailure(deps, mount, error)
          return []
        }
      }
    )

    return {
      success: true,
      result: {
        hits: dedupeHits(hitGroups.flat()),
      },
    }
  }
}
