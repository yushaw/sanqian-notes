import { RECENT_DAYS } from '../shared/types'
import type { Note, NoteGetAllOptions, LocalNoteMetadata, LocalFolderTreeResult, LocalFolderNotebookMount } from '../shared/types'
import { createLocalResourceId } from '../shared/local-resource-id'
import {
  getNotes,
  getLocalFolderMounts,
  listLocalNoteMetadata,
  listLocalNoteIdentity,
  ensureLocalNoteIdentity,
} from './database'
import { readLocalFolderFile } from './local-folder'
import {
  extractLocalTagNamesFromTiptapContent,
  mergeLocalUserAndAITagNames,
} from './local-note-tags'
import { resolveNoteResource } from './note-gateway'
import { buildNoteFromResolvedResource } from './note-gateway'

export const EMPTY_TIPTAP_DOC = '{"type":"doc","content":[]}'

export function compareNotesByPinnedAndUpdated(left: Note, right: Note): number {
  if (left.is_pinned !== right.is_pinned) {
    return left.is_pinned ? -1 : 1
  }

  const leftTime = new Date(left.updated_at).getTime()
  const rightTime = new Date(right.updated_at).getTime()
  if (leftTime !== rightTime) {
    return rightTime - leftTime
  }

  return left.id.localeCompare(right.id, undefined, { sensitivity: 'base', numeric: true })
}

export function resolveRecentThresholdMs(recentDays?: number): number {
  const normalizedDays = typeof recentDays === 'number' && Number.isFinite(recentDays) && recentDays > 0
    ? Math.floor(recentDays)
    : RECENT_DAYS
  return Date.now() - normalizedDays * 24 * 60 * 60 * 1000
}

export function applyViewTypeFilter(notes: Note[], options?: NoteGetAllOptions): Note[] {
  const viewType = options?.viewType
  if (!viewType) return notes

  switch (viewType) {
    case 'all':
      return notes.filter((note) => !note.is_daily)
    case 'recent': {
      const thresholdMs = resolveRecentThresholdMs(options?.recentDays)
      return notes.filter((note) => !note.is_daily && new Date(note.updated_at).getTime() > thresholdMs)
    }
    case 'favorites':
      return notes.filter((note) => note.is_favorite)
    case 'daily':
      return notes
        .filter((note) => note.is_daily)
        .sort((left, right) => (right.daily_date || '').localeCompare(left.daily_date || ''))
    case 'trash':
      return []
    default:
      return notes
  }
}

export function buildLocalMetadataMap(items: LocalNoteMetadata[]): Map<string, LocalNoteMetadata> {
  const byId = new Map<string, LocalNoteMetadata>()
  for (const item of items) {
    byId.set(createLocalResourceId(item.notebook_id, item.relative_path), item)
  }
  return byId
}

export function buildSynthesizedLocalNote(input: {
  id: string
  title: string
  content: string
  notebookId: string
  relativePath: string
  mtimeMs: number
  notebookName: string
  metadata: LocalNoteMetadata | null
  userTags?: string[]
}): Note {
  const updatedAt = new Date(input.mtimeMs).toISOString()
  const pathSummary = input.notebookName
    ? `${input.notebookName} · ${input.relativePath}`
    : input.relativePath

  return {
    id: input.id,
    title: input.title,
    content: input.content,
    notebook_id: input.notebookId,
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: input.metadata?.is_favorite ?? false,
    is_pinned: input.metadata?.is_pinned ?? false,
    revision: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: null,
    ai_summary: input.metadata?.ai_summary || pathSummary,
    tags: mergeLocalUserAndAITagNames(
      input.userTags || input.metadata?.tags,
      input.metadata?.ai_tags
    ),
  }
}

export interface NoteSynthesisDeps {
  getCachedLocalFolderTree: (notebookId: string, maxAgeMs: number) => LocalFolderTreeResult | null
  scanAndCacheLocalFolderTree: (mount: LocalFolderNotebookMount) => LocalFolderTreeResult
  scanAndCacheLocalFolderTreeAsync: (mount: LocalFolderNotebookMount) => Promise<LocalFolderTreeResult>
  searchScanCacheTtlMs: number
}

let deps: NoteSynthesisDeps | null = null

export function initNoteSynthesis(d: NoteSynthesisDeps): void {
  deps = d
}

export async function collectLocalNotesForGetAllAsync(options?: NoteGetAllOptions): Promise<Note[]> {
  if (!options?.includeLocal) return []

  const activeMounts = getLocalFolderMounts().filter((mount) => mount.mount.status === 'active')
  if (activeMounts.length === 0) return []

  const notebookIds = activeMounts.map((mount) => mount.notebook.id)
  const metadataById = buildLocalMetadataMap(listLocalNoteMetadata({ notebookIds }))
  const knownIdentityPaths = new Set(
    listLocalNoteIdentity({ notebookIds })
      .map((identity) => `${identity.notebook_id}\u0000${identity.relative_path}`)
  )
  const includeLocalContent = options.includeLocalContent === true
  const localNotes: Note[] = []

  for (const mount of activeMounts) {
    let tree: LocalFolderTreeResult
    try {
      tree = deps!.getCachedLocalFolderTree(
        mount.notebook.id,
        deps!.searchScanCacheTtlMs
      ) ?? await deps!.scanAndCacheLocalFolderTreeAsync(mount)
    } catch (error) {
      console.warn(`[Main] Failed to scan local folder mount ${mount.notebook.id} (${mount.mount.root_path}):`, error)
      continue
    }

    for (const file of tree.files) {
      const identityKey = `${mount.notebook.id}\u0000${file.relative_path}`
      if (!knownIdentityPaths.has(identityKey)) {
        ensureLocalNoteIdentity({
          notebook_id: mount.notebook.id,
          relative_path: file.relative_path,
        })
        knownIdentityPaths.add(identityKey)
      }
      const localId = createLocalResourceId(mount.notebook.id, file.relative_path)
      const metadata = metadataById.get(localId) || null

      if (!includeLocalContent) {
        localNotes.push(buildSynthesizedLocalNote({
          id: localId,
          title: file.name,
          content: EMPTY_TIPTAP_DOC,
          notebookId: mount.notebook.id,
          relativePath: file.relative_path,
          mtimeMs: file.mtime_ms,
          notebookName: mount.notebook.name,
          metadata,
          userTags: metadata?.tags,
        }))
        continue
      }

      const readResult = readLocalFolderFile(mount, file.relative_path)
      if (!readResult.success) {
        continue
      }

      localNotes.push(buildSynthesizedLocalNote({
        id: localId,
        title: readResult.result.name,
        content: readResult.result.tiptap_content,
        notebookId: readResult.result.notebook_id,
        relativePath: readResult.result.relative_path,
        mtimeMs: readResult.result.mtime_ms,
        notebookName: mount.notebook.name,
        metadata,
        userTags: extractLocalTagNamesFromTiptapContent(readResult.result.tiptap_content),
      }))
    }
  }

  return localNotes
}

export async function getAllNotesForRendererAsync(options?: NoteGetAllOptions): Promise<Note[]> {
  const internalNotes = getNotes()
  const localNotes = await collectLocalNotesForGetAllAsync(options)
  const mergedNotes = localNotes.length === 0
    ? internalNotes
    : [...internalNotes, ...localNotes].sort(compareNotesByPinnedAndUpdated)
  return applyViewTypeFilter(mergedNotes, options)
}

export function getNoteByIdForRenderer(id: string): Note | null {
  const resolved = resolveNoteResource(id)
  if (!resolved.ok) {
    return null
  }
  return buildNoteFromResolvedResource(resolved.resource)
}

export function getNotesByIdsForRenderer(ids: string[]): Note[] {
  const notes: Note[] = []
  for (const id of ids) {
    const note = getNoteByIdForRenderer(id)
    if (note) {
      notes.push(note)
    }
  }
  return notes
}
