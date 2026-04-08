import type {
  LocalFolderMountStatusPersistResult,
  LocalFolderNotebookMount,
  LocalFolderSearchHit,
  LocalFolderSearchResponse,
  LocalFolderTreeResult,
  LocalFolderWatchEvent,
  NotebookStatus,
} from '../shared/types'
import { hasOwnDefinedProperty, hasOwnPropertyKey } from '../shared/property-guards'
import { mapWithConcurrency } from './concurrency'
import { dedupeLocalFolderSearchHits, searchLocalFolderMountAsync } from './local-folder'
import { applyLocalFolderMountStatusTransition } from './local-folder-mount-transition'
import { resolvePersistedUnavailableMountStatus } from './local-folder-mount-convergence'
import { resolveUnavailableMountStatusFromFsError } from './local-folder-mount-fs-error'
import {
  isLocalFolderTreeRootMatched,
  resolveLocalFolderCanonicalOrRootPath,
  resolveComparableLocalFolderRootPath,
} from './local-folder-root-match'
import { resolveSearchScope, type SearchScope } from './search-scope'

const LOCAL_FOLDER_SEARCH_QUERY_MAX_LENGTH = 10_000
const LOCAL_FOLDER_SEARCH_FOLDER_RELATIVE_PATH_MAX_LENGTH = 4_096

export interface LocalFolderSearchHandlerDependencies {
  getLocalFolderMounts: () => LocalFolderNotebookMount[]
  getLocalFolderMountByNotebookId?: (
    notebookId: string
  ) => { root_path: string; canonical_root_path?: string | null; status?: NotebookStatus } | null
  getCachedLocalFolderTree: (notebookId: string, maxAgeMs: number) => LocalFolderTreeResult | null
  updateLocalFolderMountStatus: (
    notebookId: string,
    status: NotebookStatus
  ) => LocalFolderMountStatusPersistResult
  enqueueLocalNotebookIndexSync: (
    notebookId: string,
    options: { full?: boolean; immediate?: boolean; changedRelativePath?: string }
  ) => void
  invalidateLocalFolderTreeCache: (notebookId: string) => void
  stopLocalFolderWatcher?: (
    notebookId: string,
    options?: { clearPendingEvent?: boolean }
  ) => void
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
  waitForLocalFolderMutationTails?: (notebookIds?: string[]) => Promise<void> | null
  runWithLocalFolderTopologyReadScope?: <T>(task: () => Promise<T>) => Promise<T>
  runWithLocalFolderConsistentRead?: <T>(
    task: () => Promise<T>,
    notebookIds?: string[]
  ) => Promise<T>
}

function asScopeEntryId(input: unknown): 'global_search' | 'folder_search' {
  const hasRawNotebookFilter = hasOwnPropertyKey(input, 'notebook_id')
  const notebookIdInput = hasRawNotebookFilter
    ? (input as { notebook_id?: unknown }).notebook_id
    : undefined
  return hasOwnDefinedProperty(input, 'notebook_id') && notebookIdInput !== undefined
    ? 'folder_search'
    : 'global_search'
}

function parseSearchQueryInput(input: unknown): string {
  if (!hasOwnPropertyKey(input, 'query')) {
    return ''
  }
  const queryInput = (input as { query?: unknown }).query
  if (typeof queryInput !== 'string') {
    return ''
  }
  if (queryInput.includes('\0')) {
    return ''
  }
  if (queryInput.length > LOCAL_FOLDER_SEARCH_QUERY_MAX_LENGTH) {
    return ''
  }
  return queryInput.trim()
}

function hasInvalidExplicitFolderRelativePathInput(input: unknown): boolean {
  if (!hasOwnPropertyKey(input, 'folder_relative_path')) return false
  const folderRelativePathInput = (input as { folder_relative_path?: unknown }).folder_relative_path
  if (folderRelativePathInput === undefined || folderRelativePathInput === null) return false
  if (typeof folderRelativePathInput !== 'string') return true
  if (folderRelativePathInput.includes('\0')) return true
  if (folderRelativePathInput.length > LOCAL_FOLDER_SEARCH_FOLDER_RELATIVE_PATH_MAX_LENGTH) return true
  return false
}

function normalizeSearchQueryForSingleFlight(query: string): string {
  const normalized = query.trim().normalize('NFC').toLowerCase()
  if (!normalized) return ''
  return normalized.split(/\s+/).filter(Boolean).join(' ')
}

function buildSingleFlightCompositeKey(parts: readonly (string | null)[]): string {
  return JSON.stringify(parts)
}

function buildLocalFolderSearchSingleFlightKey(scope: SearchScope, query: string): string {
  const normalizedQuery = normalizeSearchQueryForSingleFlight(query)
  if (scope.kind === 'global') {
    return buildSingleFlightCompositeKey(['global', normalizedQuery])
  }
  if (scope.kind === 'current_notebook') {
    return buildSingleFlightCompositeKey(['notebook', scope.notebookId, normalizedQuery])
  }
  return buildSingleFlightCompositeKey([
    'folder',
    scope.notebookId,
    scope.folderRelativePath ?? null,
    normalizedQuery,
  ])
}

function mapMountStatusToSearchError(status: NotebookStatus): LocalFolderSearchResponse {
  if (status === 'permission_required') {
    return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
  }
  return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
}

function resolveRootMatchedCachedTree(
  deps: Pick<
    LocalFolderSearchHandlerDependencies,
    'getCachedLocalFolderTree' | 'searchScanCacheTtlMs' | 'invalidateLocalFolderTreeCache'
  >,
  mount: LocalFolderNotebookMount
): LocalFolderTreeResult | undefined {
  const cachedTree = deps.getCachedLocalFolderTree(
    mount.notebook.id,
    deps.searchScanCacheTtlMs
  ) ?? undefined
  if (!cachedTree) return undefined
  // Fail closed: avoid mixing stale trees across relinked roots.
  if (!isLocalFolderTreeRootMatched(cachedTree, mount.mount)) {
    try {
      deps.invalidateLocalFolderTreeCache(mount.notebook.id)
    } catch (invalidateError) {
      console.error(
        `[localFolder:search] failed to invalidate stale local folder tree cache: notebook=${mount.notebook.id}`,
        invalidateError
      )
    }
    return undefined
  }
  return cachedTree
}

function resolveSearchFailureUnavailableStatus(
  deps: Pick<LocalFolderSearchHandlerDependencies, 'resolveMountStatusFromFsError'>,
  mount: LocalFolderNotebookMount,
  error: unknown
): Extract<NotebookStatus, 'missing' | 'permission_required'> | null {
  let unavailableStatus: Extract<NotebookStatus, 'missing' | 'permission_required'> | null = null
  try {
    unavailableStatus = resolveUnavailableMountStatusFromFsError(
      error,
      deps.resolveMountStatusFromFsError
    )
  } catch (resolveStatusError) {
    console.error(
      `[localFolder:search] failed to resolve mount status from search failure: notebook=${mount.notebook.id}`,
      resolveStatusError
    )
    return 'missing'
  }
  if (!unavailableStatus) {
    console.error(
      `[localFolder:search] skip mount status convergence for non-fs search failure: notebook=${mount.notebook.id}`,
      error
    )
    return null
  }

  return unavailableStatus
}

function handleMountSearchFailure(
  deps: Pick<
    LocalFolderSearchHandlerDependencies,
    'getLocalFolderMountByNotebookId'
    |
    'resolveMountStatusFromFsError'
    | 'updateLocalFolderMountStatus'
    | 'enqueueLocalNotebookIndexSync'
    | 'invalidateLocalFolderTreeCache'
    | 'stopLocalFolderWatcher'
    | 'scheduleLocalFolderWatchEvent'
  >,
  mount: LocalFolderNotebookMount,
  error: unknown
): NotebookStatus | null {
  const unavailableStatus = resolveSearchFailureUnavailableStatus(deps, mount, error)
  if (!unavailableStatus) {
    return null
  }
  let nextStatus: NotebookStatus = unavailableStatus

  let transitionResult: ReturnType<typeof applyLocalFolderMountStatusTransition> | null = null
  try {
    transitionResult = applyLocalFolderMountStatusTransition({
      updateLocalFolderMountStatus: deps.updateLocalFolderMountStatus,
      notebookId: mount.notebook.id,
      status: nextStatus,
      context: 'localFolder:search',
      enqueueLocalNotebookIndexSync: deps.enqueueLocalNotebookIndexSync,
      scheduleLocalFolderWatchEvent: deps.scheduleLocalFolderWatchEvent,
      enqueue: { full: true, immediate: true },
      event: {
        reason: 'status_changed',
        changed_relative_path: null,
      },
    })
  } catch (transitionError) {
    console.error(
      `[localFolder:search] failed to apply mount status transition after search failure: notebook=${mount.notebook.id}`,
      transitionError
    )
  }

  if (transitionResult?.updateResult === 'not_found') {
    nextStatus = 'missing'
  } else {
    const unavailableStatus = nextStatus === 'permission_required' ? 'permission_required' : 'missing'
    nextStatus = resolvePersistedUnavailableMountStatus({
      getLocalFolderMountByNotebookId: deps.getLocalFolderMountByNotebookId,
      notebookId: mount.notebook.id,
      fallback: unavailableStatus,
      context: 'localFolder:search',
    })
  }

  try {
    deps.invalidateLocalFolderTreeCache(mount.notebook.id)
  } catch (invalidateError) {
    console.error(
      `[localFolder:search] failed to invalidate local folder tree cache after search failure: notebook=${mount.notebook.id}`,
      invalidateError
    )
  }
  if (deps.stopLocalFolderWatcher) {
    try {
      deps.stopLocalFolderWatcher(mount.notebook.id, { clearPendingEvent: false })
    } catch (stopError) {
      console.error(
        `[localFolder:search] failed to stop local folder watcher after search failure: notebook=${mount.notebook.id}`,
        stopError
      )
    }
  }

  return nextStatus
}

export function createLocalFolderSearchHandler(deps: LocalFolderSearchHandlerDependencies) {
  const searchLocalFolderMount = deps.searchLocalFolderMount ?? searchLocalFolderMountAsync
  const dedupeHits = deps.dedupeHits ?? dedupeLocalFolderSearchHits
  const inFlightSearchByKey = new Map<string, Promise<LocalFolderSearchResponse>>()

  return async (input: unknown): Promise<LocalFolderSearchResponse> => {
    const query = parseSearchQueryInput(input)
    if (!query) {
      return { success: true, result: { hits: [] } }
    }
    if (hasInvalidExplicitFolderRelativePathInput(input)) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }

    const notebookIdInput = hasOwnPropertyKey(input, 'notebook_id')
      ? (input as { notebook_id?: unknown }).notebook_id
      : null
    const folderRelativePathInput = hasOwnPropertyKey(input, 'folder_relative_path')
      ? (input as { folder_relative_path?: unknown }).folder_relative_path
      : null
    const scope = resolveSearchScope({
      entryId: asScopeEntryId(input),
      notebookId: notebookIdInput ?? null,
      folderRelativePath: folderRelativePathInput ?? null,
    })
    if (!scope.success) {
      if (scope.errorCode === 'SEARCH_SCOPE_NOTEBOOK_REQUIRED') {
        return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
      }
      return { success: true, result: { hits: [] } }
    }

    const resolvedScope = scope.scope
    const searchKey = buildLocalFolderSearchSingleFlightKey(resolvedScope, query)
    const inFlightTask = inFlightSearchByKey.get(searchKey)
    if (inFlightTask) {
      return inFlightTask
    }

    const searchTask = (async (): Promise<LocalFolderSearchResponse> => {
      const scopedNotebookIds = resolvedScope.kind === 'global'
        ? undefined
        : [resolvedScope.notebookId]
      const getActiveMountComparablePathMap = (mounts: LocalFolderNotebookMount[]): Map<string, string> => {
        const comparablePathByNotebookId = new Map<string, string>()
        for (const mount of mounts) {
          if (mount.mount.status !== 'active') continue
          comparablePathByNotebookId.set(
            mount.notebook.id,
            resolveComparableLocalFolderRootPath(mount.mount)
          )
        }
        return comparablePathByNotebookId
      }
      const runWithConsistentRead = deps.runWithLocalFolderConsistentRead
        ?? (async <T>(task: () => Promise<T>, notebookIds?: string[]): Promise<T> => {
          const mutationTail = deps.waitForLocalFolderMutationTails?.(notebookIds) ?? null
          if (mutationTail) {
            await mutationTail
          }
          const runWithTopologyReadScope = deps.runWithLocalFolderTopologyReadScope
            ?? (async <V>(topologyReadTask: () => Promise<V>): Promise<V> => topologyReadTask())
          return runWithTopologyReadScope(task)
        })

      type SearchGateSnapshot =
        | { kind: 'error'; response: LocalFolderSearchResponse }
        | {
          kind: 'scoped'
          mount: LocalFolderNotebookMount
          folderRelativePath: string | null
          expectedComparablePath: string
        }
        | {
          kind: 'global'
          activeMounts: LocalFolderNotebookMount[]
          activeComparablePathByNotebookId: Map<string, string>
        }

      const gateSnapshot = await runWithConsistentRead(async (): Promise<SearchGateSnapshot> => {
        let allMounts: LocalFolderNotebookMount[]
        try {
          allMounts = deps.getLocalFolderMounts()
        } catch (error) {
          console.error('[localFolder:search] failed to load mounts:', error)
          return { kind: 'error', response: { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' } }
        }

        if (resolvedScope.kind !== 'global') {
          const mount = allMounts.find((item) => item.notebook.id === resolvedScope.notebookId)
          if (!mount) {
            return { kind: 'error', response: { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' } }
          }
          if (mount.mount.status === 'missing') {
            return { kind: 'error', response: { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' } }
          }
          if (mount.mount.status === 'permission_required') {
            return { kind: 'error', response: { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' } }
          }
          const folderRelativePath = resolvedScope.kind === 'current_folder_subtree'
            ? resolvedScope.folderRelativePath
            : null
          return {
            kind: 'scoped',
            mount,
            folderRelativePath,
            expectedComparablePath: resolveComparableLocalFolderRootPath(mount.mount),
          }
        }

        const activeMounts = allMounts.filter((mount) => mount.mount.status === 'active')
        return {
          kind: 'global',
          activeMounts,
          activeComparablePathByNotebookId: getActiveMountComparablePathMap(activeMounts),
        }
      }, scopedNotebookIds)

      if (gateSnapshot.kind === 'error') {
        return gateSnapshot.response
      }

      if (gateSnapshot.kind === 'scoped') {
        let hits: LocalFolderSearchHit[]
        try {
          const scannedTree = resolveRootMatchedCachedTree(deps, gateSnapshot.mount)
          hits = await searchLocalFolderMount(
            gateSnapshot.mount,
            query,
            gateSnapshot.folderRelativePath,
            scannedTree
          )
        } catch (error) {
          const nextStatus = handleMountSearchFailure(deps, gateSnapshot.mount, error)
          if (!nextStatus) {
            return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
          }
          return mapMountStatusToSearchError(nextStatus)
        }

        let dedupedHits = hits
        try {
          dedupedHits = dedupeHits(hits)
        } catch (error) {
          console.error('[localFolder:search] failed to dedupe scoped hits, falling back to raw hits:', error)
        }

        // Consistency guard: if mount status/root changed while searching, drop stale result.
        if (deps.getLocalFolderMountByNotebookId) {
          try {
            const latestMount = deps.getLocalFolderMountByNotebookId(gateSnapshot.mount.notebook.id)
            if (!latestMount) {
              return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
            }
            if (latestMount.status && latestMount.status !== 'active') {
              return mapMountStatusToSearchError(latestMount.status)
            }
            if (resolveComparableLocalFolderRootPath(latestMount) !== gateSnapshot.expectedComparablePath) {
              let latestScopedMount: LocalFolderNotebookMount = {
                ...gateSnapshot.mount,
                mount: {
                  ...gateSnapshot.mount.mount,
                  root_path: latestMount.root_path,
                  canonical_root_path: resolveLocalFolderCanonicalOrRootPath(latestMount),
                  status: 'active',
                },
              }
              try {
                const latestMounts = deps.getLocalFolderMounts()
                const matchedLatestMount = latestMounts.find((item) => item.notebook.id === gateSnapshot.mount.notebook.id)
                if (!matchedLatestMount) {
                  return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
                }
                if (matchedLatestMount.mount.status !== 'active') {
                  return mapMountStatusToSearchError(matchedLatestMount.mount.status)
                }
                latestScopedMount = matchedLatestMount
              } catch (error) {
                console.warn('[localFolder:search] failed to load latest mounts for scoped search rerun:', error)
              }

              let latestHits: LocalFolderSearchHit[]
              try {
                latestHits = await searchLocalFolderMount(
                  latestScopedMount,
                  query,
                  gateSnapshot.folderRelativePath
                )
              } catch (error) {
                const nextStatus = handleMountSearchFailure(deps, latestScopedMount, error)
                if (!nextStatus) {
                  return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
                }
                return mapMountStatusToSearchError(nextStatus)
              }

              let dedupedLatestHits = latestHits
              try {
                dedupedLatestHits = dedupeHits(latestHits)
              } catch (error) {
                console.error('[localFolder:search] failed to dedupe rerun scoped hits, falling back to raw hits:', error)
              }

              // Final fail-closed check: if mount topology drifts again while the
              // scoped rerun is in-flight, drop stale hits.
              const expectedComparablePathAfterRerun = resolveComparableLocalFolderRootPath(latestScopedMount.mount)
              const latestMountAfterRerun = deps.getLocalFolderMountByNotebookId(gateSnapshot.mount.notebook.id)
              if (!latestMountAfterRerun) {
                return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
              }
              if (latestMountAfterRerun.status && latestMountAfterRerun.status !== 'active') {
                return mapMountStatusToSearchError(latestMountAfterRerun.status)
              }
              if (resolveComparableLocalFolderRootPath(latestMountAfterRerun) !== expectedComparablePathAfterRerun) {
                return { success: true, result: { hits: [] } }
              }

              return { success: true, result: { hits: dedupedLatestHits } }
            }
          } catch (error) {
            console.warn('[localFolder:search] failed to validate scoped mount state after search:', error)
          }
        }

        return { success: true, result: { hits: dedupedHits } }
      }

      const hitGroups = await mapWithConcurrency(
        gateSnapshot.activeMounts,
        deps.globalSearchConcurrency,
        async (mount): Promise<LocalFolderSearchHit[]> => {
          try {
            const scannedTree = resolveRootMatchedCachedTree(deps, mount)
            return await searchLocalFolderMount(mount, query, null, scannedTree)
          } catch (error) {
            void handleMountSearchFailure(deps, mount, error)
            return []
          }
        }
      )

      const flatHits = hitGroups.flat()
      let dedupedHits = flatHits
      try {
        dedupedHits = dedupeHits(flatHits)
      } catch (error) {
        console.error('[localFolder:search] failed to dedupe global hits, falling back to raw hits:', error)
      }

      // Consistency guard: if mount status/root changed while searching, drop stale hits
      // and rerun only for drifted active mounts to avoid transient result loss.
      try {
        const latestMounts = deps.getLocalFolderMounts()
        const latestActiveMounts = latestMounts.filter((mount) => mount.mount.status === 'active')
        const latestActiveComparablePathByNotebookId = getActiveMountComparablePathMap(latestActiveMounts)
        const latestActiveMountByNotebookId = new Map<string, LocalFolderNotebookMount>()
        const expectedComparablePathByNotebookId = new Map<string, string>(
          gateSnapshot.activeComparablePathByNotebookId
        )
        for (const mount of latestActiveMounts) {
          latestActiveMountByNotebookId.set(mount.notebook.id, mount)
        }

        const driftedActiveMounts: LocalFolderNotebookMount[] = []
        for (const [notebookId, expectedComparablePath] of gateSnapshot.activeComparablePathByNotebookId.entries()) {
          const latestComparablePath = latestActiveComparablePathByNotebookId.get(notebookId)
          if (!latestComparablePath || latestComparablePath === expectedComparablePath) {
            continue
          }
          expectedComparablePathByNotebookId.set(notebookId, latestComparablePath)
          const latestMount = latestActiveMountByNotebookId.get(notebookId)
          if (latestMount) {
            driftedActiveMounts.push(latestMount)
          }
        }

        dedupedHits = dedupedHits.filter((hit) => {
          const expectedComparablePath = gateSnapshot.activeComparablePathByNotebookId.get(hit.notebook_id)
          if (!expectedComparablePath) return false
          const latestComparablePath = latestActiveComparablePathByNotebookId.get(hit.notebook_id)
          return latestComparablePath === expectedComparablePath
        })

        if (driftedActiveMounts.length > 0) {
          const rerunHitGroups = await mapWithConcurrency(
            driftedActiveMounts,
            deps.globalSearchConcurrency,
            async (mount): Promise<LocalFolderSearchHit[]> => {
              try {
                const scannedTree = resolveRootMatchedCachedTree(deps, mount)
                return await searchLocalFolderMount(mount, query, null, scannedTree)
              } catch (error) {
                void handleMountSearchFailure(deps, mount, error)
                return []
              }
            }
          )
          const mergedHits = dedupedHits.concat(rerunHitGroups.flat())
          try {
            dedupedHits = dedupeHits(mergedHits)
          } catch (error) {
            console.error('[localFolder:search] failed to dedupe global rerun hits, falling back to merged hits:', error)
            dedupedHits = mergedHits
          }
        }

        // Final fail-closed check: if mount topology drifts again while rerun is in-flight,
        // drop now-stale notebook hits instead of returning outdated search results.
        const latestAfterRerun = deps.getLocalFolderMounts()
          .filter((mount) => mount.mount.status === 'active')
        const latestComparablePathAfterRerunByNotebookId = getActiveMountComparablePathMap(latestAfterRerun)
        dedupedHits = dedupedHits.filter((hit) => {
          const expectedComparablePath = expectedComparablePathByNotebookId.get(hit.notebook_id)
          if (!expectedComparablePath) return false
          const latestComparablePath = latestComparablePathAfterRerunByNotebookId.get(hit.notebook_id)
          return latestComparablePath === expectedComparablePath
        })
      } catch (error) {
        console.warn('[localFolder:search] failed to validate global mount state after search:', error)
      }

      return {
        success: true,
        result: {
          hits: dedupedHits,
        },
      }
    })()

    inFlightSearchByKey.set(searchKey, searchTask)
    try {
      return await searchTask
    } finally {
      if (inFlightSearchByKey.get(searchKey) === searchTask) {
        inFlightSearchByKey.delete(searchKey)
      }
    }
  }
}
