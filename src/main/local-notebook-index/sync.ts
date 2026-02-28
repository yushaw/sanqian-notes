import type { LocalFolderTreeResult } from '../../shared/types'
import {
  getLocalFolderMounts,
  getLocalNoteIdentityByPath,
  ensureLocalNoteIdentity,
} from '../database'
import { readLocalFolderFile } from '../local-folder'
import { cleanupMissingLocalNoteState } from '../local-note-state-cleanup'
import { indexingService } from '../embedding'
import { scanAndCacheLocalFolderTree } from '../local-folder-tree-cache'
import {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  deleteLegacyLocalIndexByPath,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNotePopupRefs,
  deleteLocalNoteMetadataByPath,
  deleteLocalNoteIdentityByPath,
} from './helpers'
import { isKnowledgeBaseRebuilding } from './knowledge-base-rebuild'

const LOCAL_NOTE_INDEX_SYNC_DEBOUNCE_MS = 900

const localNotebookIndexSyncRequests = new Map<string, { full: boolean; paths: Set<string> }>()
const localNotebookIndexSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
const localNotebookIndexSyncRunning = new Set<string>()
let localNotebookIndexSyncSequence: Promise<void> = Promise.resolve()
let localNotebookIndexSyncGeneration = 0

export function cancelPendingLocalNotebookIndexSync(options?: { invalidateRunning?: boolean }): void {
  if (options?.invalidateRunning) {
    localNotebookIndexSyncGeneration += 1
  }
  for (const timer of localNotebookIndexSyncTimers.values()) {
    clearTimeout(timer)
  }
  localNotebookIndexSyncTimers.clear()
  localNotebookIndexSyncRequests.clear()
}

function isLocalNotebookIndexSyncCancelled(runGeneration: number): boolean {
  return runGeneration !== localNotebookIndexSyncGeneration
}

async function syncLocalNotebookIndex(
  notebookId: string,
  request: { full: boolean; paths: Set<string> },
  runGeneration: number
): Promise<void> {
  if (isLocalNotebookIndexSyncCancelled(runGeneration)) {
    return
  }

  const mount = getLocalFolderMounts().find((item) => item.notebook.id === notebookId)
  if (!mount || mount.mount.status !== 'active') {
    deleteIndexedLocalNotesByNotebook(notebookId)
    return
  }

  // Incremental fast-path: changed files only, skip full tree scan.
  if (!request.full) {
    if (request.paths.size === 0) {
      return
    }
    for (const relativePath of request.paths) {
      if (isLocalNotebookIndexSyncCancelled(runGeneration)) return
      const previousIdentity = getLocalNoteIdentityByPath({
        notebook_id: notebookId,
        relative_path: relativePath,
      })
      const readResult = readLocalFolderFile(mount, relativePath)
      if (!readResult.success) {
        deleteIndexForLocalPath(notebookId, relativePath, {
          noteUid: previousIdentity?.note_uid || null,
        })
        if (
          readResult.errorCode === 'LOCAL_FILE_NOT_FOUND'
          || readResult.errorCode === 'LOCAL_FILE_NOT_A_FILE'
          || readResult.errorCode === 'LOCAL_FILE_UNSUPPORTED_TYPE'
          || readResult.errorCode === 'LOCAL_FILE_OUT_OF_ROOT'
        ) {
          deleteLocalNoteMetadataByPath({
            notebook_id: notebookId,
            relative_path: relativePath,
            kind: 'file',
          })
          deleteLocalNoteIdentityByPath({
            notebook_id: notebookId,
            relative_path: relativePath,
            kind: 'file',
          })
        }
        continue
      }
      ensureLocalNoteIdentity({
        notebook_id: notebookId,
        relative_path: relativePath,
      })
      try {
        syncLocalNoteTagsMetadata(notebookId, relativePath, readResult.result.tiptap_content)
      } catch (error) {
        console.warn('[LocalIndex] Failed to sync local tags metadata:', notebookId, relativePath, error)
      }
      try {
        syncLocalNotePopupRefs(notebookId, relativePath, readResult.result.tiptap_content)
      } catch (error) {
        console.warn('[LocalIndex] Failed to sync local popup refs:', notebookId, relativePath, error)
      }
      const localId = resolveLocalIndexNoteId(notebookId, relativePath)
      try {
        deleteLegacyLocalIndexByPath(notebookId, relativePath)
        await indexingService.checkAndIndex(
          localId,
          notebookId,
          readResult.result.tiptap_content,
          { ftsOnly: true, fileMtimeMs: readResult.result.mtime_ms }
        )
        if (isLocalNotebookIndexSyncCancelled(runGeneration)) {
          indexingService.deleteNoteIndex(localId)
          deleteLegacyLocalIndexByPath(notebookId, relativePath)
          return
        }
      } catch (error) {
        console.warn('[LocalIndex] Failed to check index for local file:', localId, error)
      }
    }
    return
  }

  let scannedTree: LocalFolderTreeResult
  try {
    scannedTree = scanAndCacheLocalFolderTree(mount)
  } catch (error) {
    console.warn('[LocalIndex] Failed to scan local mount for indexing sync:', notebookId, error)
    return
  }

  const indexedLocalIds = collectIndexedLocalNoteIdsByNotebook(notebookId)
  const fileByRelativePath = new Map<string, LocalFolderTreeResult['files'][number]>()
  const currentLocalIds = new Set<string>()

  for (const file of scannedTree.files) {
    if (isLocalNotebookIndexSyncCancelled(runGeneration)) return
    const normalizedPath = normalizeLocalIndexSyncPath(file.relative_path)
    if (!normalizedPath) continue
    ensureLocalNoteIdentity({
      notebook_id: notebookId,
      relative_path: normalizedPath,
    })
    fileByRelativePath.set(normalizedPath, file)
    currentLocalIds.add(resolveLocalIndexNoteId(notebookId, normalizedPath))
  }

  cleanupMissingLocalNoteState(
    notebookId,
    new Set(fileByRelativePath.keys()),
    normalizeLocalIndexSyncPath
  )

  for (const indexedId of indexedLocalIds) {
    if (currentLocalIds.has(indexedId)) continue
    indexingService.deleteNoteIndex(indexedId)
  }

  const pathsToIndex = new Set<string>()
  for (const relativePath of fileByRelativePath.keys()) {
    const localId = resolveLocalIndexNoteId(notebookId, relativePath)
    if (request.full || !indexedLocalIds.has(localId)) {
      pathsToIndex.add(relativePath)
    }
  }

  for (const changedPath of request.paths) {
    if (fileByRelativePath.has(changedPath)) {
      pathsToIndex.add(changedPath)
      continue
    }
    deleteIndexForLocalPath(notebookId, changedPath)
  }

  for (const relativePath of pathsToIndex) {
    if (isLocalNotebookIndexSyncCancelled(runGeneration)) return
    const localId = resolveLocalIndexNoteId(notebookId, relativePath)
    const readResult = readLocalFolderFile(mount, relativePath)
    if (!readResult.success) {
      indexingService.deleteNoteIndex(localId)
      deleteLegacyLocalIndexByPath(notebookId, relativePath)
      continue
    }
    try {
      syncLocalNoteTagsMetadata(notebookId, relativePath, readResult.result.tiptap_content)
    } catch (error) {
      console.warn('[LocalIndex] Failed to sync local tags metadata:', notebookId, relativePath, error)
    }
    try {
      syncLocalNotePopupRefs(notebookId, relativePath, readResult.result.tiptap_content)
    } catch (error) {
      console.warn('[LocalIndex] Failed to sync local popup refs:', notebookId, relativePath, error)
    }
    try {
      deleteLegacyLocalIndexByPath(notebookId, relativePath)
      await indexingService.checkAndIndex(
        localId,
        notebookId,
        readResult.result.tiptap_content,
        { ftsOnly: true, fileMtimeMs: readResult.result.mtime_ms }
      )
      if (isLocalNotebookIndexSyncCancelled(runGeneration)) {
        indexingService.deleteNoteIndex(localId)
        deleteLegacyLocalIndexByPath(notebookId, relativePath)
        return
      }
    } catch (error) {
      console.warn('[LocalIndex] Failed to check index for local file:', localId, error)
    }
  }
}

function scheduleLocalNotebookIndexSync(notebookId: string, immediate = false): void {
  if (isKnowledgeBaseRebuilding()) return

  const existingTimer = localNotebookIndexSyncTimers.get(notebookId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    localNotebookIndexSyncTimers.delete(notebookId)
  }

  const timer = setTimeout(() => {
    localNotebookIndexSyncTimers.delete(notebookId)
    void runQueuedLocalNotebookIndexSync(notebookId)
  }, immediate ? 0 : LOCAL_NOTE_INDEX_SYNC_DEBOUNCE_MS)
  localNotebookIndexSyncTimers.set(notebookId, timer)
}

function runQueuedLocalNotebookIndexSync(notebookId: string): void {
  if (localNotebookIndexSyncRunning.has(notebookId)) return
  const queued = localNotebookIndexSyncRequests.get(notebookId)
  if (!queued) return

  localNotebookIndexSyncRequests.delete(notebookId)
  localNotebookIndexSyncRunning.add(notebookId)
  const runGeneration = localNotebookIndexSyncGeneration

  const run = async () => {
    try {
      await syncLocalNotebookIndex(notebookId, queued, runGeneration)
    } catch (error) {
      console.warn('[LocalIndex] Failed to sync local notebook index:', notebookId, error)
    } finally {
      localNotebookIndexSyncRunning.delete(notebookId)
      if (localNotebookIndexSyncRequests.has(notebookId)) {
        scheduleLocalNotebookIndexSync(notebookId, true)
      }
    }
  }

  localNotebookIndexSyncSequence = localNotebookIndexSyncSequence
    .catch(() => undefined)
    .then(run)
}

export function enqueueLocalNotebookIndexSync(
  notebookId: string,
  options?: { full?: boolean; changedRelativePath?: string | null; immediate?: boolean }
): void {
  const normalizedNotebookId = notebookId.trim()
  if (!normalizedNotebookId) return

  const existing = localNotebookIndexSyncRequests.get(normalizedNotebookId) || {
    full: false,
    paths: new Set<string>(),
  }

  if (options?.full) {
    existing.full = true
  }
  const changedRelativePath = normalizeLocalIndexSyncPath(options?.changedRelativePath)
  if (changedRelativePath) {
    existing.paths.add(changedRelativePath)
  }

  localNotebookIndexSyncRequests.set(normalizedNotebookId, existing)
  scheduleLocalNotebookIndexSync(normalizedNotebookId, options?.immediate === true)
}

export function flushQueuedLocalNotebookIndexSync(): void {
  if (isKnowledgeBaseRebuilding()) return
  for (const notebookId of localNotebookIndexSyncRequests.keys()) {
    scheduleLocalNotebookIndexSync(notebookId, true)
  }
}

export async function rebuildLocalNotebookIndexesAfterInternalRebuild(): Promise<void> {
  const runGeneration = localNotebookIndexSyncGeneration
  const mounts = getLocalFolderMounts()

  for (const mount of mounts) {
    if (isLocalNotebookIndexSyncCancelled(runGeneration)) return
    await syncLocalNotebookIndex(
      mount.notebook.id,
      { full: true, paths: new Set<string>() },
      runGeneration
    )
  }
}

export function hasPendingIndexSync(): boolean {
  return (
    localNotebookIndexSyncRunning.size > 0
    || localNotebookIndexSyncRequests.size > 0
    || localNotebookIndexSyncTimers.size > 0
  )
}

export function clearLocalNotebookIndexSyncForNotebook(notebookId: string): void {
  localNotebookIndexSyncRequests.delete(notebookId)
  const timer = localNotebookIndexSyncTimers.get(notebookId)
  if (timer) {
    clearTimeout(timer)
    localNotebookIndexSyncTimers.delete(notebookId)
  }
  localNotebookIndexSyncRunning.delete(notebookId)
}

export function resetLocalNotebookIndexSyncState(): void {
  localNotebookIndexSyncRunning.clear()
  localNotebookIndexSyncSequence = Promise.resolve()
}
