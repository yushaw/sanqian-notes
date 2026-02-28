import { useCallback, useMemo } from 'react'
import { useVersionedDebouncedSearch } from './useVersionedDebouncedSearch'
import { toast } from '../utils/toast'
import type { LocalFolderFileErrorCode, NotebookStatus } from '../types/note'

export interface UseLocalFolderSearchOptions {
  selectedNotebookId: string | null
  selectedLocalSearchSourceType: string | null
  selectedLocalSearchStatus: NotebookStatus
  selectedLocalFolderPath: string | null
  localFolderTreeScannedAt: string | undefined
  localStatusToastAtRef: React.MutableRefObject<Map<string, number>>
  resolveLocalFileErrorMessage: (errorCode: LocalFolderFileErrorCode) => string
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
  } = options

  const executeLocalSearch = useCallback(async (query: string): Promise<string[] | null> => {
    if (
      !selectedNotebookId
      || selectedLocalSearchSourceType !== 'local-folder'
      || selectedLocalSearchStatus !== 'active'
    ) {
      return null
    }

    const result = await window.electron.localFolder.search({
      query,
      notebook_id: selectedNotebookId,
      folder_relative_path: selectedLocalFolderPath,
    })

    if (!result.success) {
      const toastKey = `local-search:${localFolderTreeScannedAt || 'unknown'}:${result.errorCode}`
      const now = Date.now()
      const lastToastAt = localStatusToastAtRef.current.get(toastKey) ?? 0
      if (now - lastToastAt > 4000) {
        localStatusToastAtRef.current.set(toastKey, now)
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
      }
      return []
    }

    const seen = new Set<string>()
    const matchedPaths: string[] = []
    for (const hit of result.result.hits) {
      if (seen.has(hit.relative_path)) continue
      seen.add(hit.relative_path)
      matchedPaths.push(hit.relative_path)
    }
    return matchedPaths
  }, [
    localFolderTreeScannedAt,
    localStatusToastAtRef,
    resolveLocalFileErrorMessage,
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
