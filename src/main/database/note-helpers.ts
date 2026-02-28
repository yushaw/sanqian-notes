import { getDb } from './connection'
import type { Notebook, Result } from '../../shared/types'

/**
 * Get note count for each notebook
 */
export function getNoteCountByNotebook(): Record<string, number> {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT notebook_id, COUNT(*) as count
    FROM notes
    WHERE deleted_at IS NULL AND notebook_id IS NOT NULL
    GROUP BY notebook_id
  `)
  const rows = stmt.all() as { notebook_id: string; count: number }[]
  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.notebook_id] = row.count
  }
  return result
}

/**
 * Move a note to a different notebook
 */
export type MoveNoteResult = Result<void, 'note_not_found' | 'notebook_not_found' | 'target_not_allowed'>

export function moveNote(noteId: string, notebookId: string | null): MoveNoteResult {
  const db = getDb()
  const note = db.prepare(`
    SELECT id, notebook_id, folder_path
    FROM notes
    WHERE id = ? AND deleted_at IS NULL
  `).get(noteId) as { id: string; notebook_id: string | null; folder_path: string | null } | undefined
  if (!note) return { ok: false, error: 'note_not_found' }

  if (notebookId !== null) {
    const notebook = db.prepare('SELECT id, source_type FROM notebooks WHERE id = ?').get(notebookId) as
      | { id: string; source_type: Notebook['source_type'] | null }
      | undefined
    if (!notebook) return { ok: false, error: 'notebook_not_found' }
    if ((notebook.source_type || 'internal') === 'local-folder') {
      return { ok: false, error: 'target_not_allowed' }
    }
  }

  const shouldClearFolderPath = notebookId === null || notebookId !== note.notebook_id
  const nextFolderPath = shouldClearFolderPath ? null : note.folder_path

  const updateStmt = db.prepare(`
    UPDATE notes
    SET notebook_id = ?, folder_path = ?, updated_at = ?, revision = revision + 1
    WHERE id = ?
  `)
  updateStmt.run(notebookId, nextFolderPath, new Date().toISOString(), noteId)
  return { ok: true }
}
