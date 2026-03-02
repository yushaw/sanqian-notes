import { extname } from 'path'
import { normalizeRelativeSlashPath } from '../path-compat'
import { ALLOWED_EXTENSIONS } from '../local-folder/path'
import {
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityUidsByNotebook,
  getLocalNoteMetadata,
  updateLocalNoteMetadata,
  ensureLocalNoteIdentity,
  replaceAIPopupRefsForNote,
  deleteLocalNoteMetadataByPath,
  deleteLocalNoteIdentityByPath,
} from '../database'
import {
  areLocalTagNameListsEqual,
  extractLocalTagNamesFromTiptapContent,
} from '../local-note-tags'
import { createLocalResourceId, parseLocalResourceId } from '../../shared/local-resource-id'
import { buildCanonicalLocalResourceId } from '../note-gateway'
import { indexingService, getAllIndexStatus } from '../embedding'

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
    const identityUids = getLocalNoteIdentityUidsByNotebook(notebookId)
    for (const status of getAllIndexStatus()) {
      const localRef = parseLocalResourceId(status.noteId)
      if (localRef && localRef.notebookId === notebookId) {
        ids.add(status.noteId)
        continue
      }
      if (identityUids.has(status.noteId)) {
        ids.add(status.noteId)
      }
    }
  } catch (error) {
    console.warn('[LocalIndex] Failed to list indexed status:', error)
  }
  return ids
}

export function deleteIndexedLocalNotesByNotebook(notebookId: string): void {
  const noteIds = collectIndexedLocalNoteIdsByNotebook(notebookId)
  for (const noteId of noteIds) {
    indexingService.deleteNoteIndex(noteId)
  }
}

export function deleteIndexForLocalPath(
  notebookId: string,
  relativePath: string,
  options?: { noteUid?: string | null }
): void {
  const normalizedPath = normalizeLocalIndexSyncPath(relativePath)
  if (!normalizedPath) return

  const canonicalId = options?.noteUid || getLocalNoteIdentityByPath({
    notebook_id: notebookId,
    relative_path: normalizedPath,
  })?.note_uid || null
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
  tiptapContent: string
): void {
  const normalizedPath = normalizeLocalIndexSyncPath(relativePath)
  if (!normalizedPath) return

  const identity = ensureLocalNoteIdentity({
    notebook_id: notebookId,
    relative_path: normalizedPath,
  })
  const noteUid = identity?.note_uid || null
  if (!noteUid) return

  replaceAIPopupRefsForNote({
    note_id: noteUid,
    source_type: 'local-folder',
    tiptap_content: tiptapContent,
  })
}

export { deleteLocalNoteMetadataByPath, deleteLocalNoteIdentityByPath }
