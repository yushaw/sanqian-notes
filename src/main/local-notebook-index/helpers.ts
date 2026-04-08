import { extname } from 'path'
import { normalizeRelativeSlashPath } from '../path-compat'
import { ALLOWED_EXTENSIONS } from '../local-folder/path'
import {
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityUidsByNotebook,
  getLocalNoteMetadata,
  updateLocalNoteMetadata,
  updateLocalNoteTagsBatch,
  ensureLocalNoteIdentity,
  replaceAIPopupRefsForNote,
  replaceAIPopupRefsForNotesBatch,
  deleteLocalNoteMetadataByPath,
  deleteLocalNoteIdentityByPath,
} from '../database'
import {
  areLocalTagNameListsEqual,
  extractLocalTagNamesFromTiptapContent,
} from '../local-note-tags'
import { buildLocalResourceIdPrefix, createLocalResourceId } from '../../shared/local-resource-id'
import { buildCanonicalLocalResourceId } from '../note-gateway'
import { parseRequiredNotebookIdInput } from '../notebook-id'
import {
  indexingService,
  getIndexedExistingNoteIds,
  getIndexedNoteIdsByPrefix,
} from '../embedding'
import { parseRequiredLocalNoteUidInput } from '../local-note-uid'

function deleteIndexedLocalNotes(noteIds: readonly string[]): void {
  if (!Array.isArray(noteIds) || noteIds.length === 0) return
  if (noteIds.length > 1 && typeof indexingService.deleteNoteIndexes === 'function') {
    indexingService.deleteNoteIndexes(noteIds)
    return
  }
  for (const noteId of noteIds) {
    indexingService.deleteNoteIndex(noteId)
  }
}

export function normalizeLocalIndexSyncPath(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null
  const normalized = normalizeRelativeSlashPath(relativePath)
  if (!normalized) return null
  // Reject hidden files (e.g. atomic-write temp files like .file.tmp-xxx)
  if (normalized.split('/').some((segment) => segment.startsWith('.'))) return null
  // Reject paths without a valid note extension (e.g. directory names like "Ideas")
  if (!ALLOWED_EXTENSIONS.has(extname(normalized).toLowerCase())) return null
  return normalized
}

export function resolveLocalIndexNoteId(notebookId: string, relativePath: string): string {
  return buildCanonicalLocalResourceId({
    notebookId,
    relativePath,
  })
}

export function deleteLegacyLocalIndexByPath(notebookId: string, relativePath: string): void {
  indexingService.deleteNoteIndex(createLocalResourceId(notebookId, relativePath))
}

export function collectIndexedLocalNoteIdsByNotebook(notebookId: string): Set<string> {
  const ids = new Set<string>()
  try {
    const canonicalPrefix = buildLocalResourceIdPrefix(notebookId)
    const legacyUnencodedCanonicalPrefix = notebookId.includes(':')
      ? `local:${notebookId}:`
      : null
    const legacyPrefix = `${notebookId}:`
    const identityUids = getLocalNoteIdentityUidsByNotebook(notebookId, { repairIfNeeded: false })

    for (const noteId of getIndexedNoteIdsByPrefix(canonicalPrefix)) {
      ids.add(noteId)
    }
    // Backward cleanup path for canonical IDs generated before notebook-id colon encoding.
    if (legacyUnencodedCanonicalPrefix) {
      for (const noteId of getIndexedNoteIdsByPrefix(legacyUnencodedCanonicalPrefix)) {
        ids.add(noteId)
      }
    }
    for (const noteId of getIndexedNoteIdsByPrefix(legacyPrefix)) {
      ids.add(noteId)
    }

    if (identityUids.size > 0) {
      for (const noteId of getIndexedExistingNoteIds(Array.from(identityUids))) {
        ids.add(noteId)
      }
    }
  } catch (error) {
    console.warn('[LocalIndex] Failed to list indexed status:', error)
  }
  return ids
}

export function deleteIndexedLocalNotesByNotebook(notebookId: string): void {
  const noteIds = collectIndexedLocalNoteIdsByNotebook(notebookId)
  deleteIndexedLocalNotes(Array.from(noteIds))
}

export function deleteIndexForLocalPath(
  notebookId: string,
  relativePath: string,
  options?: { noteUid?: string | null }
): void {
  const normalizedPath = normalizeLocalIndexSyncPath(relativePath)
  if (!normalizedPath) return

  let canonicalId = parseRequiredLocalNoteUidInput(options?.noteUid)
  if (!canonicalId) {
    canonicalId = parseRequiredLocalNoteUidInput(getLocalNoteIdentityByPath({
      notebook_id: notebookId,
      relative_path: normalizedPath,
    }, { repairIfNeeded: false })?.note_uid)
  }
  if (canonicalId) {
    indexingService.deleteNoteIndex(canonicalId)
  }

  deleteLegacyLocalIndexByPath(notebookId, normalizedPath)
}

export function syncLocalNoteTagsMetadata(
  notebookId: string,
  relativePath: string,
  tiptapContent: string
): void {
  const normalizedPath = normalizeLocalIndexSyncPath(relativePath)
  if (!normalizedPath) return

  const nextTags = extractLocalTagNamesFromTiptapContent(tiptapContent)
  const current = getLocalNoteMetadata({
    notebook_id: notebookId,
    relative_path: normalizedPath,
  })
  if (areLocalTagNameListsEqual(current?.tags, nextTags)) {
    return
  }

  updateLocalNoteMetadata({
    notebook_id: notebookId,
    relative_path: normalizedPath,
    tags: nextTags,
  })
}

export function syncLocalNotePopupRefs(
  notebookId: string,
  relativePath: string,
  tiptapContent: string,
  options?: { noteUid?: string | null }
): void {
  const normalizedPath = normalizeLocalIndexSyncPath(relativePath)
  if (!normalizedPath) return

  let noteUid = parseRequiredLocalNoteUidInput(options?.noteUid)
  if (!noteUid) {
    const identity = ensureLocalNoteIdentity({
      notebook_id: notebookId,
      relative_path: normalizedPath,
    })
    noteUid = parseRequiredLocalNoteUidInput(identity?.note_uid) || null
  }
  if (!noteUid) return

  replaceAIPopupRefsForNote({
    note_id: noteUid,
    source_type: 'local-folder',
    tiptap_content: tiptapContent,
  })
}

export function syncLocalNoteTagsMetadataBatch(input: {
  notebookId: string
  updates: ReadonlyArray<{
    relativePath: string
    tiptapContent: string
  }>
}): void {
  const parsedNotebookId = parseRequiredNotebookIdInput(input.notebookId)
  if (!parsedNotebookId) return
  if (!Array.isArray(input.updates) || input.updates.length === 0) return

  const normalizedUpdates = input.updates
    .map((update) => {
      const normalizedPath = normalizeLocalIndexSyncPath(update.relativePath)
      if (!normalizedPath) return null
      return {
        relative_path: normalizedPath,
        tags: extractLocalTagNamesFromTiptapContent(update.tiptapContent),
      }
    })
    .filter(Boolean) as Array<{ relative_path: string; tags: string[] }>

  if (normalizedUpdates.length === 0) return
  updateLocalNoteTagsBatch({
    notebook_id: parsedNotebookId,
    updates: normalizedUpdates,
  })
}

export function syncLocalNotePopupRefsBatch(input: {
  updates: ReadonlyArray<{
    noteUid: string | null | undefined
    tiptapContent: string
  }>
}): void {
  if (!Array.isArray(input.updates) || input.updates.length === 0) return

  const notes = input.updates
    .map((update) => {
      const noteId = parseRequiredLocalNoteUidInput(update.noteUid)
      if (!noteId) return null
      return {
        note_id: noteId,
        tiptap_content: update.tiptapContent,
      }
    })
    .filter(Boolean) as Array<{ note_id: string; tiptap_content: string }>

  if (notes.length === 0) return
  replaceAIPopupRefsForNotesBatch({
    source_type: 'local-folder',
    notes,
  })
}

export { deleteLocalNoteMetadataByPath, deleteLocalNoteIdentityByPath }
