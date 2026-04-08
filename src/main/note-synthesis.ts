import type { Note, NoteGetAllOptions, LocalNoteMetadata, LocalFolderTreeResult, LocalFolderNotebookMount } from '../shared/types'
import { applyViewTypeFilter } from '../shared/note-filters'
export { applyViewTypeFilter, resolveRecentThresholdMs } from '../shared/note-filters'
import { createLocalResourceId } from '../shared/local-resource-id'
import {
  getNotes,
  getLocalFolderMounts,
  listLocalNoteMetadata,
  listLocalNoteIdentity,
  ensureLocalNoteIdentity,
  ensureLocalNoteIdentitiesBatch,
} from './database'
import { readLocalFolderFileAsync } from './local-folder'
import { yieldToEventLoop } from './local-folder/cache'
import {
  extractLocalTagNamesFromTiptapContent,
  mergeLocalUserAndAITagNames,
} from './local-note-tags'
import { resolveNoteResource, resolveNoteResourceAsync, buildNoteFromResolvedResource } from './note-gateway'

export const EMPTY_TIPTAP_DOC = '{"type":"doc","content":[]}'
const NOTE_SYNTHESIS_YIELD_INTERVAL = Number.isFinite(Number(process.env.NOTE_SYNTHESIS_YIELD_INTERVAL))
  ? Math.max(8, Math.floor(Number(process.env.NOTE_SYNTHESIS_YIELD_INTERVAL)))
  : 64
const NOTE_SYNTHESIS_IDENTITY_BATCH_SIZE = Number.isFinite(Number(process.env.NOTE_SYNTHESIS_IDENTITY_BATCH_SIZE))
  ? Math.max(32, Math.floor(Number(process.env.NOTE_SYNTHESIS_IDENTITY_BATCH_SIZE)))
  : 512

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

async function maybeYieldNoteSynthesis(count: number): Promise<void> {
  if (count <= 0) return
  if (count % NOTE_SYNTHESIS_YIELD_INTERVAL !== 0) return
  await yieldToEventLoop()
}

async function ensureKnownIdentityPathsForMountAsync(input: {
  mount: LocalFolderNotebookMount
  files: ReadonlyArray<{ relative_path: string }>
  knownIdentityPaths: Set<string>
}): Promise<void> {
  const notebookId = input.mount.notebook.id
  const missingPaths: string[] = []

  for (const file of input.files) {
    const identityKey = `${notebookId}\u0000${file.relative_path}`
    if (!input.knownIdentityPaths.has(identityKey)) {
      missingPaths.push(file.relative_path)
    }
  }
  if (missingPaths.length === 0) return

  for (let offset = 0; offset < missingPaths.length; offset += NOTE_SYNTHESIS_IDENTITY_BATCH_SIZE) {
    const chunk = missingPaths.slice(offset, offset + NOTE_SYNTHESIS_IDENTITY_BATCH_SIZE)
    try {
      const ensuredByPath = ensureLocalNoteIdentitiesBatch({
        notebook_id: notebookId,
        relative_paths: chunk,
      })
      for (const relativePath of chunk) {
        if (ensuredByPath.get(relativePath)) {
          input.knownIdentityPaths.add(`${notebookId}\u0000${relativePath}`)
        }
      }
    } catch (error) {
      console.warn(
        `[Main] Failed to batch ensure local note identities for synthesized local notes ${notebookId}; falling back to single-path ensure:`,
        error
      )
      for (const relativePath of chunk) {
        try {
          const identity = ensureLocalNoteIdentity({
            notebook_id: notebookId,
            relative_path: relativePath,
          })
          if (identity) {
            input.knownIdentityPaths.add(`${notebookId}\u0000${relativePath}`)
          }
        } catch (singleError) {
          console.warn(
            `[Main] Failed to ensure local note identity for synthesized local note ${notebookId}:${relativePath}:`,
            singleError
          )
        }
      }
    }
    await maybeYieldNoteSynthesis(offset + chunk.length)
  }
}

export async function collectLocalNotesForGetAllAsync(options?: NoteGetAllOptions): Promise<Note[]> {
  if (!options?.includeLocal) return []

  const activeMounts = getLocalFolderMounts().filter((mount) => mount.mount.status === 'active')
  if (activeMounts.length === 0) return []

  const notebookIds = activeMounts.map((mount) => mount.notebook.id)
  const metadataById = buildLocalMetadataMap(listLocalNoteMetadata({ notebookIds }))
  const knownIdentityPaths = new Set(
    listLocalNoteIdentity({ notebookIds }, { repairIfNeeded: false })
      .map((identity) => `${identity.notebook_id}\u0000${identity.relative_path}`)
  )
  const includeLocalContent = options.includeLocalContent === true
  const localNotes: Note[] = []
  let synthesizedCount = 0

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

    await ensureKnownIdentityPathsForMountAsync({
      mount,
      files: tree.files,
      knownIdentityPaths,
    })

    for (const file of tree.files) {
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
        synthesizedCount += 1
        await maybeYieldNoteSynthesis(synthesizedCount)
        continue
      }

      const readResult = await readLocalFolderFileAsync(mount, file.relative_path)
      if (!readResult.success) {
        synthesizedCount += 1
        await maybeYieldNoteSynthesis(synthesizedCount)
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
      synthesizedCount += 1
      await maybeYieldNoteSynthesis(synthesizedCount)
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

export async function getNoteByIdForRendererAsync(id: string): Promise<Note | null> {
  const resolved = await resolveNoteResourceAsync(id)
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

export async function getNotesByIdsForRendererAsync(ids: string[]): Promise<Note[]> {
  const notes: Note[] = []
  for (let index = 0; index < ids.length; index += 1) {
    const note = await getNoteByIdForRendererAsync(ids[index])
    if (note) {
      notes.push(note)
    }
    await maybeYieldNoteSynthesis(index + 1)
  }
  return notes
}
