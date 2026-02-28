import type {
  LocalFolderSearchResponse,
  LocalNoteMetadata,
  Note,
  Notebook,
  NoteSearchFilter,
  SmartViewId,
} from '../types/note'
import { mergeGlobalSearchResults, shouldIncludeLocalInGlobalSearch } from './globalSearch'

interface UnifiedSearchInput {
  query: string
  selectedNotebookId: string | null
  selectedSmartView: SmartViewId | null
  notebooks: Notebook[]
  localNoteMetadataById?: Record<string, LocalNoteMetadata>
  searchInternal: (query: string, filter: NoteSearchFilter) => Promise<Note[]>
  searchLocal: (query: string) => Promise<LocalFolderSearchResponse>
}

export async function runUnifiedSearch(input: UnifiedSearchInput): Promise<Note[]> {
  const {
    query,
    selectedNotebookId,
    selectedSmartView,
    notebooks,
    localNoteMetadataById,
    searchInternal,
    searchLocal,
  } = input

  if (selectedNotebookId) {
    const selectedNotebook = notebooks.find((nb) => nb.id === selectedNotebookId)
    if (selectedNotebook?.source_type === 'local-folder') {
      return []
    }
  }

  const filter: NoteSearchFilter = selectedNotebookId
    ? { notebookId: selectedNotebookId }
    : { viewType: selectedSmartView || 'all' }
  const includeLocal = shouldIncludeLocalInGlobalSearch(selectedNotebookId, selectedSmartView)
  const internalSearchPromise = searchInternal(query, filter)
  if (!includeLocal) {
    return internalSearchPromise
  }
  const localSearchPromise = searchLocal(query).catch(() => null)
  const [internalResults, localSearchResult] = await Promise.all([
    internalSearchPromise,
    localSearchPromise,
  ])
  if (!localSearchResult?.success) {
    return internalResults
  }

  return mergeGlobalSearchResults(
    internalResults,
    localSearchResult.result.hits,
    notebooks,
    selectedSmartView,
    localNoteMetadataById
  )
}
