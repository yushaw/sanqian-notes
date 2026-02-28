import { normalizeComparablePathForFileSystem } from '../path-compat'
import { getDb } from './connection'
import type { Notebook, NotebookStatus } from '../../shared/types'

/**
 * Escape LIKE special characters in a path for use as a prefix pattern.
 * Returns `escapedPath/%` suitable for `LIKE ? ESCAPE '\'` clauses.
 */
export function escapeLikePrefix(path: string): string {
  const escaped = path.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  return `${escaped}/%`
}

/** SQL fragment: `LIKE ? ESCAPE '\'` -- use with escapeLikePrefix() */
export const LIKE_ESCAPE = `LIKE ? ESCAPE '\\'`

export const TRASH_RETENTION_DAYS = 30

// Database row interfaces (snake_case columns)
export interface AIActionRow {
  id: string
  name: string
  description: string | null
  icon: string
  prompt: string
  mode: string
  show_in_context_menu: number
  show_in_slash_command: number
  show_in_shortcut: number
  shortcut_key: string | null
  order_index: number
  is_builtin: number
  enabled: number
  created_at: string
  updated_at: string
}

export interface LocalNoteMetadataRow {
  notebook_id: string
  relative_path: string
  is_favorite: number
  is_pinned: number
  ai_summary: string | null
  summary_content_hash: string | null
  tags_json: string | null
  ai_tags_json: string | null
  updated_at: string
}

export interface LocalNoteIdentityRow {
  note_uid: string
  notebook_id: string
  relative_path: string
  created_at: string
  updated_at: string
}

export interface LocalFolderMountRowLike {
  notebook_id: string
  root_path: string
  canonical_root_path: string
  canonical_compare_path?: string | null
  status: NotebookStatus
  updated_at: string
}

export function buildCanonicalComparePath(canonicalRootPath: string, rootPath?: string): string {
  const referencePath = rootPath || canonicalRootPath
  return normalizeComparablePathForFileSystem(canonicalRootPath, referencePath)
}

export function compareLocalFolderMountPriority(a: LocalFolderMountRowLike, b: LocalFolderMountRowLike): number {
  if (a.status !== b.status) {
    if (a.status === 'active') return -1
    if (b.status === 'active') return 1
  }

  const aUpdatedAt = Date.parse(a.updated_at || '')
  const bUpdatedAt = Date.parse(b.updated_at || '')
  if (Number.isFinite(aUpdatedAt) && Number.isFinite(bUpdatedAt) && aUpdatedAt !== bUpdatedAt) {
    return bUpdatedAt - aUpdatedAt
  }
  if (Number.isFinite(aUpdatedAt) && !Number.isFinite(bUpdatedAt)) return -1
  if (!Number.isFinite(aUpdatedAt) && Number.isFinite(bUpdatedAt)) return 1

  return a.notebook_id.localeCompare(b.notebook_id, undefined, { sensitivity: 'base', numeric: true })
}

export function hasInternalNoteId(noteId: string): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT id
    FROM notes
    WHERE id = ?
    LIMIT 1
  `).get(noteId) as { id: string } | undefined
  return Boolean(row)
}

export function hasLocalNoteUid(noteUid: string): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT note_uid
    FROM local_note_identity
    WHERE note_uid = ?
    LIMIT 1
  `).get(noteUid) as { note_uid: string } | undefined
  return Boolean(row)
}

export function isLocalFolderNotebookId(notebookId: string): boolean {
  const db = getDb()
  const notebook = db.prepare(`
    SELECT id, source_type
    FROM notebooks
    WHERE id = ?
  `).get(notebookId) as { id: string; source_type: Notebook['source_type'] | null } | undefined
  if (!notebook) return false
  return (notebook.source_type || 'internal') === 'local-folder'
}
