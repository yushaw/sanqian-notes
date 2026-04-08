/**
 * Search result building, merging, and context list helpers for SDK tools.
 */

import type { AppContextListItem } from '@yushaw/sanqian-chat/main'
import type { LocalFolderSearchHit, LocalNoteMetadata } from '../../../shared/types'
import {
  getLocalResourceFileTitle,
} from '../../../shared/local-resource-id'
import {
  getLocalFolderMounts,
} from '../../database'
import { hybridSearch } from '../../embedding/semantic-search'
import {
  dedupeLocalFolderSearchHits,
  searchLocalFolderMountAsync,
} from '../../local-folder'
import { resolveNoteResourceAsync, buildCanonicalLocalResourceId } from '../../note-gateway'
import { extractLocalTagNamesFromTiptapContent } from '../../local-note-tags'
import { truncateText, generateNoteLink } from './note-link'
import {
  type LocalContextSourceItem,
  resolveLocalNotebookIdFromAnyId,
  getLocalFolderScanWithCacheAsync,
  pruneLocalFolderScanCache,
  pruneLocalOverviewSummaryCache,
  buildLocalCanonicalPath,
  buildLocalContextCacheKey,
  getCachedLocalContextSourceItems,
  setCachedLocalContextSourceItems,
  normalizeContextQuery,
  LOCAL_CONTEXT_QUERY_CACHE_TTL_MS,
  LOCAL_CONTEXT_BROWSE_CACHE_TTL_MS,
} from './caching'
import {
  buildLocalNoteMetadataByIdMap,
  getLocalNoteMetadataFromMap,
} from './local-note-helpers'

// --- Types ---

export interface SearchToolResultItem {
  id: string
  title: string
  link: string | null
  preview: string
  score: number
  updated_at: string
  notebook_id: string | null
  notebook_name: string | null
  tags: string[]
  summary: string | null
  is_pinned: boolean
  is_favorite: boolean
  source_type: 'internal' | 'local-folder'
  relative_path?: string
}

// --- Local search collection ---

export async function collectLocalSearchHitsSafely(
  mounts: ReturnType<typeof getLocalFolderMounts>,
  query: string,
  folderRelativePath: string | null = null
): Promise<ReturnType<typeof dedupeLocalFolderSearchHits>> {
  pruneLocalFolderScanCache(mounts)
  const hits: LocalFolderSearchHit[] = []

  for (const mount of mounts) {
    try {
      const scanned = await getLocalFolderScanWithCacheAsync(mount)
      const mountHits = await searchLocalFolderMountAsync(mount, query, folderRelativePath, scanned)
      hits.push(...mountHits)
    } catch (error) {
      console.warn(
        '[SanqianSDK] Failed to search local mount:',
        mount.notebook.id,
        mount.mount.root_path,
        error
      )
    }
  }

  return dedupeLocalFolderSearchHits(hits, Number.MAX_SAFE_INTEGER)
}

// --- Context list building ---

export async function buildLocalContextListItems(
  notebookNameMap: Map<string, string>,
  query?: string
): Promise<AppContextListItem[]> {
  const mounts = getLocalFolderMounts().filter((mount) => mount.mount.status === 'active')
  pruneLocalFolderScanCache(mounts)
  pruneLocalOverviewSummaryCache(mounts)
  if (mounts.length === 0) return []

  const trimmedQuery = normalizeContextQuery(query)
  const cacheKey = buildLocalContextCacheKey(mounts, trimmedQuery)
  const cachedItems = getCachedLocalContextSourceItems(cacheKey)
  if (cachedItems) {
    return cachedItems.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      icon: '\uD83D\uDCC4',
      type: 'note',
      group: notebookNameMap.get(item.notebookId) || undefined,
      updatedAt: item.updatedAt,
      tags: ['local-folder'],
    }))
  }

  // Build metadata map only after cache miss to avoid unnecessary DB queries
  const metadataById = buildLocalNoteMetadataByIdMap(mounts.map((mount) => mount.notebook.id))
  const sourceItems: LocalContextSourceItem[] = []

  if (trimmedQuery) {
    const hits = await collectLocalSearchHitsSafely(mounts, trimmedQuery)
    for (const hit of hits) {
      const metadata = getLocalNoteMetadataFromMap(metadataById, hit.notebook_id, hit.relative_path)
      sourceItems.push({
        id: buildCanonicalLocalResourceId({ notebookId: hit.notebook_id, relativePath: hit.relative_path }),
        title: getLocalResourceFileTitle(hit.relative_path),
        summary: metadata?.ai_summary || hit.snippet || hit.relative_path,
        notebookId: hit.notebook_id,
        updatedAt: new Date(hit.mtime_ms).toISOString(),
      })
    }
    setCachedLocalContextSourceItems(cacheKey, sourceItems, LOCAL_CONTEXT_QUERY_CACHE_TTL_MS)
  } else {
    const deduped = new Map<string, {
      id: string
      title: string
      relativePath: string
      notebookId: string
      updatedAt: string
      mtimeMs: number
      canonicalPath: string
    }>()

    for (const mount of mounts) {
      let scanned: ReturnType<typeof import('../../local-folder').scanLocalFolderMount>
      try {
        scanned = await getLocalFolderScanWithCacheAsync(mount)
      } catch (error) {
        console.warn(
          '[SanqianSDK] Failed to scan local mount:',
          mount.notebook.id,
          mount.mount.root_path,
          error
        )
        continue
      }
      for (const file of scanned.files) {
        const canonicalPath = buildLocalCanonicalPath(mount.mount.canonical_root_path, file.relative_path)
        const candidate = {
          id: buildCanonicalLocalResourceId({ notebookId: mount.notebook.id, relativePath: file.relative_path }),
          title: file.name || getLocalResourceFileTitle(file.relative_path),
          relativePath: file.relative_path,
          notebookId: mount.notebook.id,
          updatedAt: new Date(file.mtime_ms).toISOString(),
          mtimeMs: file.mtime_ms,
          canonicalPath,
        }
        const existing = deduped.get(canonicalPath)
        if (!existing) {
          deduped.set(canonicalPath, candidate)
          continue
        }
        if (candidate.mtimeMs > existing.mtimeMs) {
          deduped.set(canonicalPath, candidate)
          continue
        }
        if (
          candidate.mtimeMs === existing.mtimeMs
          && candidate.id.localeCompare(existing.id, undefined, { sensitivity: 'base', numeric: true }) < 0
        ) {
          deduped.set(canonicalPath, candidate)
        }
      }
    }

    sourceItems.push(
      ...Array.from(deduped.values())
        .sort((a, b) => {
          if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
          return a.canonicalPath.localeCompare(b.canonicalPath, undefined, { sensitivity: 'base', numeric: true })
        })
        .map((item) => ({
          id: item.id,
          title: item.title,
          summary: getLocalNoteMetadataFromMap(metadataById, item.notebookId, item.relativePath)?.ai_summary || item.relativePath,
          notebookId: item.notebookId,
          updatedAt: item.updatedAt,
        }))
    )
    setCachedLocalContextSourceItems(cacheKey, sourceItems, LOCAL_CONTEXT_BROWSE_CACHE_TTL_MS)
  }

  return sourceItems.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    icon: '\uD83D\uDCC4',
    type: 'note',
    group: notebookNameMap.get(item.notebookId) || undefined,
    updatedAt: item.updatedAt,
    tags: ['local-folder'],
  }))
}

// --- Hybrid search result mapping ---

export async function buildHybridSearchResultItems(
  hybridResults: Awaited<ReturnType<typeof hybridSearch>>,
  notebookNameMap: Map<string, string>
): Promise<SearchToolResultItem[]> {
  const localNotebookIds = Array.from(new Set(
    hybridResults
      .map((result) => resolveLocalNotebookIdFromAnyId(result.noteId))
      .filter((id): id is string => Boolean(id))
  ))
  const localMetadataById = localNotebookIds.length > 0
    ? buildLocalNoteMetadataByIdMap(localNotebookIds)
    : new Map<string, LocalNoteMetadata>()

  const items: SearchToolResultItem[] = []
  for (const result of hybridResults) {
    const resolved = await resolveNoteResourceAsync(result.noteId)
    if (!resolved.ok) continue

    const preview = result.matchedChunks[0]?.chunkText
      ? truncateText(result.matchedChunks[0].chunkText, 300)
      : ''

    if (resolved.resource.sourceType === 'internal') {
      const note = resolved.resource.note
      if (note.deleted_at) continue

      items.push({
        id: result.noteId,
        title: note.title,
        link: generateNoteLink(result.noteId),
        preview,
        score: result.score,
        updated_at: note.updated_at,
        notebook_id: result.notebookId,
        notebook_name: notebookNameMap.get(result.notebookId || '') || null,
        tags: note.tags?.map((tag) => tag.name) || [],
        summary: note.ai_summary || null,
        is_pinned: note.is_pinned,
        is_favorite: note.is_favorite,
        source_type: 'internal',
      })
      continue
    }

    const local = resolved.resource
    const metadata = getLocalNoteMetadataFromMap(
      localMetadataById,
      local.file.notebook_id,
      local.file.relative_path
    )
    const canonicalLocalId = buildCanonicalLocalResourceId({
      notebookId: local.file.notebook_id,
      relativePath: local.file.relative_path,
    })
    items.push({
      id: canonicalLocalId,
      title: local.file.name,
      link: null,
      preview,
      score: result.score,
      updated_at: new Date(local.file.mtime_ms).toISOString(),
      notebook_id: local.file.notebook_id,
      notebook_name: notebookNameMap.get(local.file.notebook_id) || local.mount.notebook.name || null,
      tags: metadata?.tags?.length
        ? metadata.tags
        : extractLocalTagNamesFromTiptapContent(local.file.tiptap_content),
      summary: metadata?.ai_summary || null,
      is_pinned: metadata?.is_pinned ?? false,
      is_favorite: metadata?.is_favorite ?? false,
      source_type: 'local-folder',
      relative_path: local.file.relative_path,
    })
  }

  return items
}

// --- Search result merging ---

export function mergeSearchResultItems(items: SearchToolResultItem[]): SearchToolResultItem[] {
  const mergedById = new Map<string, SearchToolResultItem>()

  for (const item of items) {
    const existing = mergedById.get(item.id)
    if (!existing) {
      mergedById.set(item.id, item)
      continue
    }

    const preferIncoming = item.score > existing.score
      || (
        item.score === existing.score
        && item.updated_at.localeCompare(existing.updated_at) > 0
      )
    const primary = preferIncoming ? item : existing
    const secondary = preferIncoming ? existing : item

    mergedById.set(item.id, {
      ...primary,
      preview: primary.preview || secondary.preview,
      summary: primary.summary || secondary.summary,
      notebook_name: primary.notebook_name || secondary.notebook_name,
      tags: primary.tags.length > 0 ? primary.tags : secondary.tags,
      relative_path: primary.relative_path || secondary.relative_path,
    })
  }

  return Array.from(mergedById.values()).sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.updated_at !== b.updated_at) return b.updated_at.localeCompare(a.updated_at)
    return a.id.localeCompare(b.id, undefined, { sensitivity: 'base', numeric: true })
  })
}

// --- Local keyword search result building ---

export async function buildLocalSearchResultItems(
  query: string,
  notebookNameMap: Map<string, string>,
  notebookId?: string,
  folderRelativePath?: string | null
): Promise<SearchToolResultItem[]> {
  const mounts = getLocalFolderMounts()
  const targetMounts = notebookId
    ? mounts.filter((mount) => mount.notebook.id === notebookId)
    : mounts
  const activeMounts = targetMounts.filter((mount) => mount.mount.status === 'active')

  const normalizedFolderScope = typeof folderRelativePath === 'string'
    ? (folderRelativePath.trim() ? folderRelativePath : null)
    : null
  const hits = await collectLocalSearchHitsSafely(activeMounts, query, normalizedFolderScope)
  const metadataById = buildLocalNoteMetadataByIdMap(activeMounts.map((mount) => mount.notebook.id))

  return hits.map((hit) => {
    const localId = buildCanonicalLocalResourceId({ notebookId: hit.notebook_id, relativePath: hit.relative_path })
    const metadata = getLocalNoteMetadataFromMap(metadataById, hit.notebook_id, hit.relative_path)
    return {
      id: localId,
      title: getLocalResourceFileTitle(hit.relative_path),
      link: null,
      preview: hit.snippet,
      score: hit.score,
      updated_at: new Date(hit.mtime_ms).toISOString(),
      notebook_id: hit.notebook_id,
      notebook_name: notebookNameMap.get(hit.notebook_id) || null,
      tags: metadata?.tags || [],
      summary: metadata?.ai_summary || null,
      is_pinned: metadata?.is_pinned ?? false,
      is_favorite: metadata?.is_favorite ?? false,
      source_type: 'local-folder',
      relative_path: hit.relative_path,
    }
  })
}
