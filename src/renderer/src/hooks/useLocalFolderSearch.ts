import { useCallback, useMemo } from 'react'
import { useVersionedDebouncedSearch } from './useVersionedDebouncedSearch'
import { toast } from '../utils/toast'
import { normalizeLocalRelativePath } from '../utils/localFolderNavigation'
import type { LocalFolderFileErrorCode, NotebookStatus } from '../types/note'
import {
  buildLocalSearchRefreshToastKey,
  buildLocalSearchStatusToastKey,
  parseLocalStatusToastKey,
} from './localNotebookScopedState'

const LOCAL_SEARCH_ERROR_TOAST_COOLDOWN_MS = 4000
const LOCAL_SEARCH_MOUNT_STATUS_REFRESH_COOLDOWN_MS = 1500
const LOCAL_SEARCH_STATUS_HISTORY_LIMIT = 12

function pruneLocalSearchToastHistory(
  statusToastAtMap: Map<string, number>,
  notebookId: string,
  maxEntries: number = LOCAL_SEARCH_STATUS_HISTORY_LIMIT
): void {
  const historyEntries: Array<[string, number]> = []

  for (const [key, value] of statusToastAtMap.entries()) {
    const parsedKey = parseLocalStatusToastKey(key)
    if (!parsedKey) continue
    if (parsedKey.notebookId !== notebookId) continue
    if (parsedKey.type !== 'search') continue
    historyEntries.push([key, value])
  }
  if (historyEntries.length <= maxEntries) return

  historyEntries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })
  for (let index = maxEntries; index < historyEntries.length; index += 1) {
    statusToastAtMap.delete(historyEntries[index][0])
  }
}

export interface UseLocalFolderSearchOptions {
  selectedNotebookId: string | null
  selectedLocalSearchSourceType: string | null
  selectedLocalSearchStatus: NotebookStatus
  selectedLocalFolderPath: string | null
  localFolderTreeScannedAt: string | undefined
  localStatusToastAtRef: React.MutableRefObject<Map<string, number>>
  resolveLocalFileErrorMessage: (errorCode: LocalFolderFileErrorCode) => string
  onMountStatusSearchError?: (errorCode: LocalFolderFileErrorCode) => void
}

export function useLocalFolderSearch(options: UseLocalFolderSearchOptions) {
  const {
    selectedNotebookId,
    selectedLocalSearchSourceType,
    selectedLocalSearchStatus,
    selectedLocalFolderPath,
    localFolderTreeScannedAt,
    localStatusToastAtRef,
    resolveLocalFileErrorMessage,
    onMountStatusSearchError,
  } = options

  const executeLocalSearch = useCallback(async (query: string): Promise<string[] | null> => {
    if (
      !selectedNotebookId
      || selectedLocalSearchSourceType !== 'local-folder'
      || selectedLocalSearchStatus !== 'active'
    ) {
      return null
    }

    const normalizedFolderRelativePath = normalizeLocalRelativePath(selectedLocalFolderPath)

    const result = await window.electron.localFolder.search({
      query,
      notebook_id: selectedNotebookId,
      folder_relative_path: normalizedFolderRelativePath,
    })

    if (!result.success) {
      const notebookKey = selectedNotebookId || 'unknown'
      const scannedAtKey = localFolderTreeScannedAt || 'unknown'
      const toastKey = buildLocalSearchStatusToastKey(notebookKey, scannedAtKey, result.errorCode)
      const now = Date.now()
      const lastToastAt = localStatusToastAtRef.current.get(toastKey) ?? 0
      if (now - lastToastAt > LOCAL_SEARCH_ERROR_TOAST_COOLDOWN_MS) {
        localStatusToastAtRef.current.set(toastKey, now)
        pruneLocalSearchToastHistory(localStatusToastAtRef.current, notebookKey)
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
      }

      if (result.errorCode === 'LOCAL_FOLDER_NOT_FOUND' || result.errorCode === 'LOCAL_FILE_UNREADABLE') {
        const refreshKey = buildLocalSearchRefreshToastKey(notebookKey, result.errorCode)
        const lastRefreshAt = localStatusToastAtRef.current.get(refreshKey) ?? 0
        if (now - lastRefreshAt > LOCAL_SEARCH_MOUNT_STATUS_REFRESH_COOLDOWN_MS) {
          localStatusToastAtRef.current.set(refreshKey, now)
          onMountStatusSearchError?.(result.errorCode)
        }
      }
      return []
    }

    const seen = new Set<string>()
    const matchedPaths: string[] = []
    for (const hit of result.result.hits) {
      const normalizedRelativePath = normalizeLocalRelativePath(hit.relative_path)
      if (!normalizedRelativePath || seen.has(normalizedRelativePath)) continue
      seen.add(normalizedRelativePath)
      matchedPaths.push(normalizedRelativePath)
    }
    return matchedPaths
  }, [
    localFolderTreeScannedAt,
    localStatusToastAtRef,
    resolveLocalFileErrorMessage,
    onMountStatusSearchError,
    selectedLocalFolderPath,
    selectedLocalSearchSourceType,
    selectedLocalSearchStatus,
    selectedNotebookId,
  ])

  const handleLocalSearchError = useCallback((error: unknown) => {
    console.error('Failed to search local folder files:', error)
  }, [])

  const {
    query: localSearchQuery,
    result: localSearchMatchedPaths,
    loading: localSearchLoading,
    hasQuery: localSearchHasQuery,
    handleQueryChange: handleLocalSearchQueryChange,
    beginComposition: beginLocalSearchComposition,
    endComposition: endLocalSearchComposition,
    cancel: cancelLocalSearch,
    reset: resetLocalSearch,
  } = useVersionedDebouncedSearch<string[]>({
    execute: executeLocalSearch,
    debounceMs: 150,
    clearResultOnQueryChange: true,
    clearResultOnSearchStart: true,
    onError: handleLocalSearchError,
  })

  const localSearchMatchedPathSet = useMemo(() => {
    if (!localSearchMatchedPaths) return null
    return new Set(localSearchMatchedPaths)
  }, [localSearchMatchedPaths])

  const localSearchListLoading = useMemo(() => {
    return localSearchHasQuery && localSearchLoading && localSearchMatchedPathSet === null
  }, [localSearchHasQuery, localSearchLoading, localSearchMatchedPathSet])

  return {
    localSearchQuery,
    localSearchMatchedPathSet,
    localSearchListLoading,
    handleLocalSearchQueryChange,
    beginLocalSearchComposition,
    endLocalSearchComposition,
    cancelLocalSearch,
    resetLocalSearch,
  }
}
