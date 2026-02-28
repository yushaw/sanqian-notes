/**
 * Local note identity, metadata, and derived state helpers for SDK tools.
 */

import type { LocalNoteMetadata } from '../../../shared/types'
import {
  createLocalResourceId,
} from '../../../shared/local-resource-id'
import {
  listLocalNoteMetadata,
  getLocalNoteMetadata,
  ensureLocalNoteIdentity,
  moveLocalNoteIdentity,
  renameLocalNoteIdentityPath,
  deleteLocalNoteIdentityByPath,
  renameLocalNoteMetadataPath,
  deleteLocalNoteMetadataByPath,
  updateLocalNoteMetadata,
  replaceAIPopupRefsForNote,
} from '../../database'
import {
  areLocalTagNameListsEqual,
  extractLocalTagNamesFromTiptapContent,
} from '../../local-note-tags'

// --- Metadata map helpers ---

export function buildLocalNoteMetadataByIdMap(notebookIds?: string[]): Map<string, LocalNoteMetadata> {
  const normalizedNotebookIds = notebookIds
    ? Array.from(new Set(notebookIds.map((id) => id.trim()).filter(Boolean)))
    : undefined
  const metadata = listLocalNoteMetadata({
    notebookIds: normalizedNotebookIds && normalizedNotebookIds.length > 0
      ? normalizedNotebookIds
      : undefined,
  })
  const metadataById = new Map<string, LocalNoteMetadata>()
  for (const item of metadata) {
    metadataById.set(createLocalResourceId(item.notebook_id, item.relative_path), item)
  }
  return metadataById
}

export function getLocalNoteMetadataFromMap(
  metadataById: Map<string, LocalNoteMetadata>,
  notebookId: string,
  relativePath: string
): LocalNoteMetadata | null {
  return metadataById.get(createLocalResourceId(notebookId, relativePath)) || null
}

// --- Metadata query helpers ---

export function getLocalSummaryByPath(
  notebookId: string,
  relativePath: string,
  metadataById?: Map<string, LocalNoteMetadata>
): string | null {
  const metadata = metadataById
    ? getLocalNoteMetadataFromMap(metadataById, notebookId, relativePath)
    : getLocalNoteMetadata({ notebook_id: notebookId, relative_path: relativePath })
  return metadata?.ai_summary || null
}

export function getLocalPinFavoriteByPath(
  notebookId: string,
  relativePath: string,
  metadataById?: Map<string, LocalNoteMetadata>
): { isPinned: boolean; isFavorite: boolean } {
  const metadata = metadataById
    ? getLocalNoteMetadataFromMap(metadataById, notebookId, relativePath)
    : getLocalNoteMetadata({ notebook_id: notebookId, relative_path: relativePath })
  return {
    isPinned: metadata?.is_pinned ?? false,
    isFavorite: metadata?.is_favorite ?? false,
  }
}

// --- Identity/metadata lifecycle ---

export function migrateLocalNoteMetadataPath(
  notebookId: string,
  fromRelativePath: string,
  toRelativePath: string
): void {
  renameLocalNoteMetadataPath({
    notebook_id: notebookId,
    from_relative_path: fromRelativePath,
    to_relative_path: toRelativePath,
  })
  renameLocalNoteIdentityPath({
    notebook_id: notebookId,
    from_relative_path: fromRelativePath,
    to_relative_path: toRelativePath,
  })
}

export function ensureLocalNoteIdentityForPath(notebookId: string, relativePath: string): string | null {
  const identity = ensureLocalNoteIdentity({
    notebook_id: notebookId,
    relative_path: relativePath,
  })
  return identity?.note_uid || null
}

// --- Derived state sync ---

export function syncLocalNoteTagsMetadataByContent(
  notebookId: string,
  relativePath: string,
  tiptapContent: string
): void {
  const nextTags = extractLocalTagNamesFromTiptapContent(tiptapContent)
  const existing = getLocalNoteMetadata({
    notebook_id: notebookId,
    relative_path: relativePath,
  })
  if (areLocalTagNameListsEqual(existing?.tags, nextTags)) {
    return
  }
  updateLocalNoteMetadata({
    notebook_id: notebookId,
    relative_path: relativePath,
    tags: nextTags,
  })
}

function syncLocalNotePopupRefsByContent(
  notebookId: string,
  relativePath: string,
  tiptapContent: string
): void {
  const noteUid = ensureLocalNoteIdentityForPath(notebookId, relativePath)
  if (!noteUid) return
  replaceAIPopupRefsForNote({
    note_id: noteUid,
    source_type: 'local-folder',
    tiptap_content: tiptapContent,
  })
}

export function syncLocalNoteDerivedState(
  notebookId: string,
  relativePath: string,
  tiptapContent: string
): void {
  try {
    syncLocalNoteTagsMetadataByContent(notebookId, relativePath, tiptapContent)
  } catch (error) {
    console.warn('[SanqianSDK] Failed to sync local tags metadata:', notebookId, relativePath, error)
  }
  try {
    syncLocalNotePopupRefsByContent(notebookId, relativePath, tiptapContent)
  } catch (error) {
    console.warn('[SanqianSDK] Failed to sync local popup refs:', notebookId, relativePath, error)
  }
}

// --- Cross-notebook identity moves ---

export function moveLocalNoteIdentityAcrossNotebooks(
  fromNotebookId: string,
  fromRelativePath: string,
  toNotebookId: string,
  toRelativePath: string
): void {
  const moved = moveLocalNoteIdentity({
    from_notebook_id: fromNotebookId,
    from_relative_path: fromRelativePath,
    to_notebook_id: toNotebookId,
    to_relative_path: toRelativePath,
  })
  if (moved === 0) {
    ensureLocalNoteIdentityForPath(toNotebookId, toRelativePath)
  }
}

export function cleanupLocalNoteMetadata(
  notebookId: string,
  relativePath: string,
  kind: 'file' | 'folder' = 'file'
): void {
  deleteLocalNoteMetadataByPath({
    notebook_id: notebookId,
    relative_path: relativePath,
    kind,
  })
  deleteLocalNoteIdentityByPath({
    notebook_id: notebookId,
    relative_path: relativePath,
    kind,
  })
}
