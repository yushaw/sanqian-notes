import { RECENT_DAYS } from '../types/note'
import type { LocalFolderSearchHit, LocalNoteMetadata, Note, Notebook, SmartViewId } from '../types/note'
import { createLocalResourceId, getLocalSearchFileTitle } from './localResourceId'
import { mergeLocalMetadataTags } from './localFolderNavigation'

export function shouldIncludeLocalInGlobalSearch(
  selectedNotebookId: string | null,
  selectedSmartView: SmartViewId | null
): boolean {
  if (selectedNotebookId) return false
  if (selectedSmartView === 'daily' || selectedSmartView === 'trash') return false
  return true
}

export function buildLocalSearchResultNote(
  hit: LocalFolderSearchHit,
  notebookNameMap: Map<string, string>,
  localNoteMetadataById?: Record<string, LocalNoteMetadata>
): Note {
  const updatedAt = new Date(hit.mtime_ms).toISOString()
  const localId = createLocalResourceId(hit.notebook_id, hit.relative_path)
  const metadata = localNoteMetadataById?.[localId]
  const notebookName = notebookNameMap.get(hit.notebook_id) || ''
  const pathSummary = notebookName
    ? `${notebookName} · ${hit.relative_path}`
    : hit.relative_path
  const summary = metadata?.ai_summary || pathSummary
  const previewContent = hit.snippet
    ? `${summary}\n${hit.snippet}`
    : summary

  return {
    id: localId,
    title: getLocalSearchFileTitle(hit.relative_path),
    content: previewContent,
    notebook_id: hit.notebook_id,
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: metadata?.is_favorite ?? false,
    is_pinned: metadata?.is_pinned ?? false,
    revision: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: null,
    ai_summary: summary,
    tags: mergeLocalMetadataTags(metadata?.tags, metadata?.ai_tags),
  }
}

export function mergeGlobalSearchResults(
  internalResults: Note[],
  localHits: LocalFolderSearchHit[],
  notebooks: Notebook[],
  selectedSmartView: SmartViewId | null,
  localNoteMetadataById?: Record<string, LocalNoteMetadata>
): Note[] {
  const notebookNameMap = new Map(notebooks.map((notebook) => [notebook.id, notebook.name]))
  const recentThresholdMs = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
  const rankedLocalHits = [...localHits].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.mtime_ms !== b.mtime_ms) return b.mtime_ms - a.mtime_ms
    return a.canonical_path.localeCompare(b.canonical_path, undefined, { sensitivity: 'base', numeric: true })
  })
  const localResults = rankedLocalHits
    .filter((hit) => {
      if (selectedSmartView === 'favorites') {
        const localId = createLocalResourceId(hit.notebook_id, hit.relative_path)
        return Boolean(localNoteMetadataById?.[localId]?.is_favorite)
      }
      if (selectedSmartView === 'recent') {
        return hit.mtime_ms > recentThresholdMs
      }
      return true
    })
    .map((hit) => (
      buildLocalSearchResultNote(hit, notebookNameMap, localNoteMetadataById)
    ))

  // Keep internal search ordering from backend and append local hits ranked by local relevance.
  return [...internalResults, ...localResults]
}
