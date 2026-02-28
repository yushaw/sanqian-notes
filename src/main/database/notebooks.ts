import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import { escapeLikePrefix, LIKE_ESCAPE } from './helpers'
import type { Notebook, NotebookInput, NotebookFolder, Result } from '../../shared/types'

function getNextNotebookOrderIndex(): number {
  const db = getDb()
  const maxStmt = db.prepare('SELECT MAX(order_index) as max FROM notebooks')
  const maxResult = maxStmt.get() as { max: number | null }
  return (maxResult.max ?? -1) + 1
}

export function getNotebooks(): Notebook[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM notebooks ORDER BY order_index')
  const rows = stmt.all() as Notebook[]
  return rows.map((row) => ({
    ...row,
    source_type: row.source_type || 'internal',
  }))
}

export function addNotebook(input: NotebookInput): Notebook {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  const icon = input.icon ?? 'logo:notes'
  const sourceType = input.source_type ?? 'internal'
  const orderIndex = getNextNotebookOrderIndex()

  const stmt = db.prepare(`
    INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmt.run(id, input.name, icon, sourceType, orderIndex, now)

  return {
    id,
    name: input.name,
    icon,
    source_type: sourceType,
    order_index: orderIndex,
    created_at: now,
  }
}

export function updateNotebook(id: string, updates: Partial<NotebookInput>): Notebook | null {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM notebooks WHERE id = ?')
  const existing = stmt.get(id) as Notebook | undefined
  if (!existing) return null

  const updateStmt = db.prepare(`
    UPDATE notebooks SET name = ?, icon = ? WHERE id = ?
  `)

  updateStmt.run(
    updates.name ?? existing.name,
    updates.icon ?? existing.icon,
    id
  )

  const result = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as Notebook
  return {
    ...result,
    source_type: result.source_type || 'internal',
  }
}

export function deleteNotebook(id: string): boolean {
  const db = getDb()
  const remove = db.transaction((notebookId: string) => {
    db.prepare('UPDATE notes SET folder_path = NULL WHERE notebook_id = ? AND folder_path IS NOT NULL').run(notebookId)
    const result = db.prepare('DELETE FROM notebooks WHERE id = ?').run(notebookId)
    return result.changes > 0
  })

  return remove(id)
}

export function reorderNotebooks(orderedIds: string[]): void {
  const db = getDb()
  const existingIds = new Set(
    (db.prepare('SELECT id FROM notebooks').all() as { id: string }[]).map(r => r.id)
  )
  const validIds = orderedIds.filter(id => existingIds.has(id))
  if (validIds.length !== existingIds.size) {
    throw new Error(`reorderNotebooks: id mismatch, expected ${existingIds.size} got ${validIds.length}`)
  }

  const stmt = db.prepare('UPDATE notebooks SET order_index = ? WHERE id = ?')
  const reorder = db.transaction(() => {
    validIds.forEach((id, index) => {
      stmt.run(index, id)
    })
  })
  reorder()
}

function getFolderPathDepth(folderPath: string): number {
  return folderPath.split('/').filter(Boolean).length
}

export function getNotebookFolders(notebookId?: string): NotebookFolder[] {
  const db = getDb()
  if (notebookId) {
    const stmt = db.prepare(
      'SELECT * FROM notebook_folders WHERE notebook_id = ? ORDER BY depth ASC, folder_path ASC'
    )
    return stmt.all(notebookId) as NotebookFolder[]
  }

  const stmt = db.prepare('SELECT * FROM notebook_folders ORDER BY notebook_id ASC, depth ASC, folder_path ASC')
  return stmt.all() as NotebookFolder[]
}

export function hasNotebookFolderPathReference(input: {
  notebook_id: string
  folder_path: string
}): boolean {
  const db = getDb()
  const row = db.prepare(`
    SELECT (
      EXISTS(
        SELECT 1
        FROM notebook_folders
        WHERE notebook_id = ?
          AND folder_path = ?
      )
      OR EXISTS(
        SELECT 1
        FROM notes
        WHERE notebook_id = ?
          AND deleted_at IS NULL
          AND folder_path = ?
      )
    ) as exists_ref
  `).get(
    input.notebook_id,
    input.folder_path,
    input.notebook_id,
    input.folder_path
  ) as { exists_ref: number } | undefined

  return Boolean(row?.exists_ref)
}

export function createNotebookFolderEntry(input: {
  notebook_id: string
  folder_path: string
}): Result<NotebookFolder, 'already_exists'> {
  const db = getDb()
  const now = new Date().toISOString()
  const id = uuidv4()
  const depth = getFolderPathDepth(input.folder_path)

  try {
    db.prepare(`
      INSERT INTO notebook_folders (id, notebook_id, folder_path, depth, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.notebook_id, input.folder_path, depth, now, now)
  } catch (error) {
    console.warn(`[Database] createNotebookFolderEntry failed for ${input.notebook_id}/${input.folder_path}:`, error)
    return { ok: false, error: 'already_exists' }
  }

  const row = db.prepare(
    'SELECT * FROM notebook_folders WHERE notebook_id = ? AND folder_path = ?'
  ).get(input.notebook_id, input.folder_path) as NotebookFolder | undefined
  if (!row) {
    return { ok: false, error: 'already_exists' }
  }
  return { ok: true, value: row }
}

export function renameNotebookFolderEntry(input: {
  notebook_id: string
  folder_path: string
  next_folder_path: string
}): Result<void, 'not_found' | 'conflict'> {
  const db = getDb()
  const oldPath = input.folder_path
  const newPath = input.next_folder_path
  const oldPrefixLike = escapeLikePrefix(oldPath)
  const newPrefixLike = escapeLikePrefix(newPath)

  const existsInFolders = db.prepare(`
    SELECT id
    FROM notebook_folders
    WHERE notebook_id = ?
      AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    LIMIT 1
  `).get(input.notebook_id, oldPath, oldPrefixLike)

  const existsInNotes = db.prepare(`
    SELECT id
    FROM notes
    WHERE notebook_id = ?
      AND deleted_at IS NULL
      AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    LIMIT 1
  `).get(input.notebook_id, oldPath, oldPrefixLike)

  if (!existsInFolders && !existsInNotes) {
    return { ok: false, error: 'not_found' }
  }

  const conflictInFolders = db.prepare(`
    SELECT id
    FROM notebook_folders
    WHERE notebook_id = ?
      AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
      AND NOT (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    LIMIT 1
  `).get(input.notebook_id, newPath, newPrefixLike, oldPath, oldPrefixLike)
  if (conflictInFolders) {
    return { ok: false, error: 'conflict' }
  }

  const conflictInNotes = db.prepare(`
    SELECT id
    FROM notes
    WHERE notebook_id = ?
      AND deleted_at IS NULL
      AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
      AND NOT (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    LIMIT 1
  `).get(input.notebook_id, newPath, newPrefixLike, oldPath, oldPrefixLike)
  if (conflictInNotes) {
    return { ok: false, error: 'conflict' }
  }

  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE notebook_folders
      SET folder_path = CASE
        WHEN folder_path = ? THEN ?
        ELSE ? || SUBSTR(folder_path, LENGTH(?) + 1)
      END,
      updated_at = ?
      WHERE notebook_id = ?
        AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    `).run(oldPath, newPath, newPath, oldPath, now, input.notebook_id, oldPath, oldPrefixLike)

    db.prepare(`
      UPDATE notebook_folders
      SET depth = (LENGTH(folder_path) - LENGTH(REPLACE(folder_path, '/', '')) + 1),
          updated_at = ?
      WHERE notebook_id = ?
    `).run(now, input.notebook_id)

    db.prepare(`
      UPDATE notes
      SET folder_path = CASE
        WHEN folder_path = ? THEN ?
        ELSE ? || SUBSTR(folder_path, LENGTH(?) + 1)
      END,
      updated_at = ?
      WHERE notebook_id = ?
        AND deleted_at IS NULL
        AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    `).run(oldPath, newPath, newPath, oldPath, now, input.notebook_id, oldPath, oldPrefixLike)
  })
  tx()

  return { ok: true }
}

export function deleteNotebookFolderEntry(input: {
  notebook_id: string
  folder_path: string
}): Result<{ deletedNoteIds: string[] }, 'not_found'> {
  const db = getDb()
  const folderPath = input.folder_path
  const prefixLike = escapeLikePrefix(folderPath)

  const existsInFolders = db.prepare(`
    SELECT id
    FROM notebook_folders
    WHERE notebook_id = ?
      AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    LIMIT 1
  `).get(input.notebook_id, folderPath, prefixLike)

  const existsInNotes = db.prepare(`
    SELECT id
    FROM notes
    WHERE notebook_id = ?
      AND deleted_at IS NULL
      AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    LIMIT 1
  `).get(input.notebook_id, folderPath, prefixLike)

  if (!existsInFolders && !existsInNotes) {
    return { ok: false, error: 'not_found' }
  }

  const now = new Date().toISOString()
  const deletedNoteRows = db.prepare(`
    SELECT id
    FROM notes
    WHERE notebook_id = ?
      AND deleted_at IS NULL
      AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
  `).all(input.notebook_id, folderPath, prefixLike) as Array<{ id: string }>
  const deletedNoteIds = deletedNoteRows.map((row) => row.id)

  const CHUNK_SIZE = 500
  const tx = db.transaction(() => {
    if (deletedNoteIds.length > 0) {
      for (let i = 0; i < deletedNoteIds.length; i += CHUNK_SIZE) {
        const chunk = deletedNoteIds.slice(i, i + CHUNK_SIZE)
        const placeholders = chunk.map(() => '?').join(',')
        db.prepare(`
          UPDATE notes
          SET deleted_at = ?, updated_at = ?
          WHERE id IN (${placeholders})
        `).run(now, now, ...chunk)
      }
    }

    db.prepare(`
      DELETE FROM notebook_folders
      WHERE notebook_id = ?
        AND (folder_path = ? OR folder_path ${LIKE_ESCAPE})
    `).run(input.notebook_id, folderPath, prefixLike)
  })
  tx()

  return { ok: true, value: { deletedNoteIds } }
}
