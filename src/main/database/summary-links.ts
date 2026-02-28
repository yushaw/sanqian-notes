import { getDb } from './connection'
import { normalizeRelativeSlashPath } from '../path-compat'
import { normalizeLocalTagNames } from '../local-note-tags'
import { updateLocalNoteMetadata } from './local-note-metadata'
import type { LocalNoteMetadata } from '../../shared/types'

export interface NoteSummaryInfo {
  ai_summary: string | null
  summary_content_hash: string | null
}

interface LocalSummaryInfoInput {
  notebook_id: string
  relative_path: string
}

function normalizeLocalSummaryInfoInput(input: LocalSummaryInfoInput): LocalSummaryInfoInput | null {
  const notebookId = input.notebook_id?.trim() || ''
  const relativePath = normalizeRelativeSlashPath(input.relative_path || '')
  if (!notebookId || !relativePath) return null
  return {
    notebook_id: notebookId,
    relative_path: relativePath,
  }
}

export function getLocalNoteSummaryInfo(input: LocalSummaryInfoInput): NoteSummaryInfo | null {
  const db = getDb()
  const normalized = normalizeLocalSummaryInfoInput(input)
  if (!normalized) return null
  const row = db.prepare(`
    SELECT ai_summary, summary_content_hash
    FROM local_note_metadata
    WHERE notebook_id = ? AND relative_path = ?
  `).get(normalized.notebook_id, normalized.relative_path) as NoteSummaryInfo | undefined
  return row || null
}

export function updateLocalNoteSummary(input: {
  notebook_id: string
  relative_path: string
  summary: string
  content_hash: string
}): LocalNoteMetadata | null {
  return updateLocalNoteMetadata({
    notebook_id: input.notebook_id,
    relative_path: input.relative_path,
    ai_summary: input.summary,
    summary_content_hash: input.content_hash,
  })
}

export function updateLocalAITags(input: {
  notebook_id: string
  relative_path: string
  tag_names: string[]
}): LocalNoteMetadata | null {
  return updateLocalNoteMetadata({
    notebook_id: input.notebook_id,
    relative_path: input.relative_path,
    ai_tags: normalizeLocalTagNames(input.tag_names || []),
  })
}

/**
 * Get note summary info (for checking if regeneration needed)
 */
export function getNoteSummaryInfo(noteId: string): NoteSummaryInfo | null {
  const db = getDb()
  const stmt = db.prepare('SELECT ai_summary, summary_content_hash FROM notes WHERE id = ?')
  const row = stmt.get(noteId) as NoteSummaryInfo | undefined
  return row || null
}

/**
 * Update note AI summary
 */
export function updateNoteSummary(
  noteId: string,
  summary: string,
  contentHash: string
): boolean {
  const db = getDb()
  const stmt = db.prepare(`
    UPDATE notes
    SET ai_summary = ?, summary_content_hash = ?
    WHERE id = ?
  `)
  const result = stmt.run(summary, contentHash, noteId)
  return result.changes > 0
}
