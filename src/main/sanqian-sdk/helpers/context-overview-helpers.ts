/**
 * Context overview data source building for SDK context providers.
 */

import type { AsyncContextOverviewDataSource, ContextOverviewDataSource, ContextOverviewNote } from '../../context-overview'
import {
  getNotebooks,
  getNotesByUpdated,
  getNoteCountByNotebook,
  searchNotes,
  getNotes,
  getLocalFolderMounts,
} from '../../database'
import { resolveNoteResource, resolveNoteResourceAsync, buildCanonicalLocalResourceId } from '../../note-gateway'
import { collectOffsetPagedRows } from '../../paged-fetch'
import {
  pruneLocalFolderScanCache,
  pruneLocalOverviewSummaryCache,
  getLocalOverviewSummaryForMount,
  getLocalOverviewSummaryForMountAsync,
  getActiveLocalMountByNotebookId,
  clampPerMountRecentLimit,
  SEARCH_NOTES_PAGE_LIMIT,
  LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN,
  normalizeContextQuery,
} from './caching'
import {
  buildLocalNoteMetadataByIdMap,
  getLocalSummaryByPath,
} from './local-note-helpers'
import { buildLocalContextListItems } from './search-helpers'

// --- Internal note helpers ---

function toInternalContextOverviewNote(note: {
  id: string
  title: string
  notebook_id: string | null
  updated_at: string
  deleted_at: string | null
  ai_summary: string | null
}): ContextOverviewNote {
  return {
    id: note.id,
    title: note.title,
    notebook_id: note.notebook_id,
    updated_at: note.updated_at,
    deleted_at: note.deleted_at,
    ai_summary: note.ai_summary,
    source_type: 'internal',
  }
}

function getContextOverviewNoteById(id: string): ContextOverviewNote | null {
  const resolved = resolveNoteResource(id)
  if (!resolved.ok) return null

  if (resolved.resource.sourceType === 'internal') {
    return toInternalContextOverviewNote(resolved.resource.note)
  }

  const local = resolved.resource
  const summary = getLocalSummaryByPath(local.file.notebook_id, local.file.relative_path)
  return {
    id: buildCanonicalLocalResourceId({ notebookId: local.file.notebook_id, relativePath: local.file.relative_path }),
    title: local.file.name,
    notebook_id: local.file.notebook_id,
    updated_at: new Date(local.file.mtime_ms).toISOString(),
    deleted_at: null,
    ai_summary: summary,
    source_type: 'local-folder',
    relative_path: local.file.relative_path,
  }
}

async function getContextOverviewNoteByIdAsync(id: string): Promise<ContextOverviewNote | null> {
  const resolved = await resolveNoteResourceAsync(id)
  if (!resolved.ok) return null

  if (resolved.resource.sourceType === 'internal') {
    return toInternalContextOverviewNote(resolved.resource.note)
  }

  const local = resolved.resource
  const summary = getLocalSummaryByPath(local.file.notebook_id, local.file.relative_path)
  return {
    id: buildCanonicalLocalResourceId({ notebookId: local.file.notebook_id, relativePath: local.file.relative_path }),
    title: local.file.name,
    notebook_id: local.file.notebook_id,
    updated_at: new Date(local.file.mtime_ms).toISOString(),
    deleted_at: null,
    ai_summary: summary,
    source_type: 'local-folder',
    relative_path: local.file.relative_path,
  }
}

// --- Local overview ---

function getLocalContextOverviewRecentNotes(limitHint: number): ContextOverviewNote[] {
  const mounts = getLocalFolderMounts().filter((mount) => mount.mount.status === 'active')
  pruneLocalFolderScanCache(mounts)
  pruneLocalOverviewSummaryCache(mounts)
  if (mounts.length === 0) return []
  const metadataById = buildLocalNoteMetadataByIdMap(mounts.map((mount) => mount.notebook.id))

  const perMountRecentLimit = clampPerMountRecentLimit(mounts.length, limitHint)
  const dedupedByCanonicalPath = new Map<string, {
    note: ContextOverviewNote
    mtimeMs: number
  }>()

  for (const mount of mounts) {
    const summary = getLocalOverviewSummaryForMount(mount, perMountRecentLimit)
    if (!summary) continue

    for (const item of summary.recentItems) {
      const localSummary = getLocalSummaryByPath(item.notebookId, item.relativePath, metadataById)
      const note: ContextOverviewNote = {
        id: item.id,
        title: item.title,
        notebook_id: item.notebookId,
        updated_at: item.updatedAt,
        deleted_at: null,
        ai_summary: localSummary,
        source_type: 'local-folder',
        relative_path: item.relativePath,
      }
      const existing = dedupedByCanonicalPath.get(item.canonicalPath)
      if (!existing) {
        dedupedByCanonicalPath.set(item.canonicalPath, { note, mtimeMs: item.mtimeMs })
        continue
      }
      if (item.mtimeMs > existing.mtimeMs) {
        dedupedByCanonicalPath.set(item.canonicalPath, { note, mtimeMs: item.mtimeMs })
        continue
      }
      if (
        item.mtimeMs === existing.mtimeMs
        && note.id.localeCompare(existing.note.id, undefined, { sensitivity: 'base', numeric: true }) < 0
      ) {
        dedupedByCanonicalPath.set(item.canonicalPath, { note, mtimeMs: item.mtimeMs })
      }
    }
  }

  return Array.from(dedupedByCanonicalPath.values())
    .sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
      return a.note.id.localeCompare(b.note.id, undefined, { sensitivity: 'base', numeric: true })
    })
    .map((item) => item.note)
}

async function getLocalContextOverviewRecentNotesAsync(limitHint: number): Promise<ContextOverviewNote[]> {
  const mounts = getLocalFolderMounts().filter((mount) => mount.mount.status === 'active')
  pruneLocalFolderScanCache(mounts)
  pruneLocalOverviewSummaryCache(mounts)
  if (mounts.length === 0) return []
  const metadataById = buildLocalNoteMetadataByIdMap(mounts.map((mount) => mount.notebook.id))

  const perMountRecentLimit = clampPerMountRecentLimit(mounts.length, limitHint)
  const dedupedByCanonicalPath = new Map<string, {
    note: ContextOverviewNote
    mtimeMs: number
  }>()

  for (const mount of mounts) {
    const summary = await getLocalOverviewSummaryForMountAsync(mount, perMountRecentLimit)
    if (!summary) continue

    for (const item of summary.recentItems) {
      const localSummary = getLocalSummaryByPath(item.notebookId, item.relativePath, metadataById)
      const note: ContextOverviewNote = {
        id: item.id,
        title: item.title,
        notebook_id: item.notebookId,
        updated_at: item.updatedAt,
        deleted_at: null,
        ai_summary: localSummary,
        source_type: 'local-folder',
        relative_path: item.relativePath,
      }
      const existing = dedupedByCanonicalPath.get(item.canonicalPath)
      if (!existing) {
        dedupedByCanonicalPath.set(item.canonicalPath, { note, mtimeMs: item.mtimeMs })
        continue
      }
      if (item.mtimeMs > existing.mtimeMs) {
        dedupedByCanonicalPath.set(item.canonicalPath, { note, mtimeMs: item.mtimeMs })
        continue
      }
      if (
        item.mtimeMs === existing.mtimeMs
        && note.id.localeCompare(existing.note.id, undefined, { sensitivity: 'base', numeric: true }) < 0
      ) {
        dedupedByCanonicalPath.set(item.canonicalPath, { note, mtimeMs: item.mtimeMs })
      }
    }
  }

  return Array.from(dedupedByCanonicalPath.values())
    .sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
      return a.note.id.localeCompare(b.note.id, undefined, { sensitivity: 'base', numeric: true })
    })
    .map((item) => item.note)
}

function getContextOverviewRecentNotes(limit: number, offset: number): ContextOverviewNote[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0
  if (safeLimit === 0) return []

  const fetchSize = Math.max(20, safeOffset + safeLimit * 4)
  const internalRecent = getNotesByUpdated(fetchSize, 0).map((note) => toInternalContextOverviewNote(note))
  const localRecent = getLocalContextOverviewRecentNotes(fetchSize)
  const merged = [...internalRecent, ...localRecent].sort((a, b) => {
    if (a.updated_at !== b.updated_at) {
      return b.updated_at.localeCompare(a.updated_at)
    }
    return a.id.localeCompare(b.id, undefined, { sensitivity: 'base', numeric: true })
  })

  return merged.slice(safeOffset, safeOffset + safeLimit)
}

async function getContextOverviewRecentNotesAsync(limit: number, offset: number): Promise<ContextOverviewNote[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0
  if (safeLimit === 0) return []

  const fetchSize = Math.max(20, safeOffset + safeLimit * 4)
  const internalRecent = getNotesByUpdated(fetchSize, 0).map((note) => toInternalContextOverviewNote(note))
  const localRecent = await getLocalContextOverviewRecentNotesAsync(fetchSize)
  const merged = [...internalRecent, ...localRecent].sort((a, b) => {
    if (a.updated_at !== b.updated_at) {
      return b.updated_at.localeCompare(a.updated_at)
    }
    return a.id.localeCompare(b.id, undefined, { sensitivity: 'base', numeric: true })
  })

  return merged.slice(safeOffset, safeOffset + safeLimit)
}

function getContextOverviewNotebookCount(notebookId: string): number {
  const notebook = getNotebooks().find((item) => item.id === notebookId)
  if (!notebook) return 0
  if (notebook.source_type !== 'local-folder') {
    return getNoteCountByNotebook()[notebookId] || 0
  }

  const mount = getActiveLocalMountByNotebookId(notebookId)
  if (!mount) return 0

  const summary = getLocalOverviewSummaryForMount(mount, LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN)
  return summary?.fileCount || 0
}

async function getContextOverviewNotebookCountAsync(notebookId: string): Promise<number> {
  const notebook = getNotebooks().find((item) => item.id === notebookId)
  if (!notebook) return 0
  if (notebook.source_type !== 'local-folder') {
    return getNoteCountByNotebook()[notebookId] || 0
  }

  const mount = getActiveLocalMountByNotebookId(notebookId)
  if (!mount) return 0

  const summary = await getLocalOverviewSummaryForMountAsync(mount, LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN)
  return summary?.fileCount || 0
}

// --- Notebook note counts (merges internal + local) ---

export function getNotebookNoteCountsForAgent(): Record<string, number> {
  const counts = { ...getNoteCountByNotebook() }
  const mounts = getLocalFolderMounts()
  pruneLocalFolderScanCache(mounts)
  pruneLocalOverviewSummaryCache(mounts)

  for (const mount of mounts) {
    if (mount.mount.status !== 'active') {
      counts[mount.notebook.id] = counts[mount.notebook.id] || 0
      continue
    }

    const summary = getLocalOverviewSummaryForMount(mount, LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN)
    counts[mount.notebook.id] = summary?.fileCount || 0
  }

  return counts
}

export async function getNotebookNoteCountsForAgentAsync(): Promise<Record<string, number>> {
  const counts = { ...getNoteCountByNotebook() }
  const mounts = getLocalFolderMounts()
  pruneLocalFolderScanCache(mounts)
  pruneLocalOverviewSummaryCache(mounts)

  for (const mount of mounts) {
    if (mount.mount.status !== 'active') {
      counts[mount.notebook.id] = counts[mount.notebook.id] || 0
      continue
    }

    const summary = await getLocalOverviewSummaryForMountAsync(mount, LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN)
    counts[mount.notebook.id] = summary?.fileCount || 0
  }

  return counts
}

// --- Data source assembly ---

export function buildContextOverviewDataSource(): ContextOverviewDataSource {
  return {
    getNotebooks,
    getNoteCountByNotebook: getNotebookNoteCountsForAgent,
    getNoteCountByNotebookId: getContextOverviewNotebookCount,
    getNoteById: getContextOverviewNoteById,
    getNotes: getContextOverviewRecentNotes,
  }
}

export function buildContextOverviewDataSourceAsync(): AsyncContextOverviewDataSource {
  return {
    getNotebooks,
    getNoteCountByNotebook: getNotebookNoteCountsForAgentAsync,
    getNoteCountByNotebookId: getContextOverviewNotebookCountAsync,
    getNoteById: getContextOverviewNoteByIdAsync,
    getNotes: getContextOverviewRecentNotesAsync,
  }
}

// --- Internal context fetch ---

export function getInternalContextNotes(query: string | undefined, fetchLimit: number) {
  if (!query) {
    return getNotes(fetchLimit, 0)
  }
  return collectOffsetPagedRows(
    fetchLimit,
    SEARCH_NOTES_PAGE_LIMIT,
    (pageLimit, searchOffset) => searchNotes(query, undefined, pageLimit, searchOffset)
  )
}

// --- Editor note ref resolution ---

export async function resolveEditorNoteRefByTitle(input: { noteTitle: string }): Promise<{ noteId: string; noteTitle: string } | null> {
  const query = normalizeContextQuery(input.noteTitle)
  if (!query) return null

  const normalizedQuery = query.toLocaleLowerCase()
  const internalCandidates = getInternalContextNotes(query, 30).map((note) => ({
    id: note.id,
    title: (note.title || 'Untitled').trim(),
    updatedAt: note.updated_at,
  }))
  const notebookNameMap = new Map(getNotebooks().map((notebook) => [notebook.id, notebook.name]))
  const localCandidates = (await buildLocalContextListItems(notebookNameMap, query)).map((item) => ({
    id: item.id,
    title: (item.title || 'Untitled').trim(),
    updatedAt: item.updatedAt || '',
  }))

  const allCandidates = [...internalCandidates, ...localCandidates]
  let best: { noteId: string; noteTitle: string; score: number; updatedAt: string } | null = null

  for (const candidate of allCandidates) {
    const normalizedTitle = candidate.title.toLocaleLowerCase()
    if (!normalizedTitle) continue

    let score = 0
    if (normalizedTitle === normalizedQuery) {
      score = 4
    } else if (normalizedTitle.startsWith(normalizedQuery)) {
      score = 3
    } else if (normalizedTitle.includes(normalizedQuery)) {
      score = 2
    } else {
      continue
    }

    if (!best) {
      best = {
        noteId: candidate.id,
        noteTitle: candidate.title,
        score,
        updatedAt: candidate.updatedAt,
      }
      continue
    }

    if (score > best.score) {
      best = {
        noteId: candidate.id,
        noteTitle: candidate.title,
        score,
        updatedAt: candidate.updatedAt,
      }
      continue
    }

    if (score === best.score && candidate.updatedAt > best.updatedAt) {
      best = {
        noteId: candidate.id,
        noteTitle: candidate.title,
        score,
        updatedAt: candidate.updatedAt,
      }
    }
  }

  if (!best) return null
  return {
    noteId: best.noteId,
    noteTitle: best.noteTitle,
  }
}
