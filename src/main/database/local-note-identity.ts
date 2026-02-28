import { v4 as uuidv4 } from 'uuid'
import { getDb } from './connection'
import { normalizeRelativeSlashPath } from '../path-compat'
import { escapeLikePrefix, LIKE_ESCAPE, hasInternalNoteId, isLocalFolderNotebookId } from './helpers'
import type { LocalNoteIdentityRow } from './helpers'

export interface LocalNoteIdentity {
  note_uid: string
  notebook_id: string
  relative_path: string
  created_at: string
  updated_at: string
}

function normalizeLocalIdentityRelativePath(relativePath: string): string {
  return normalizeRelativeSlashPath(relativePath)
}

function normalizeLocalIdentityUid(noteUid: string): string {
  return noteUid.trim().toLowerCase()
}

function rowToLocalNoteIdentity(row: LocalNoteIdentityRow): LocalNoteIdentity {
  return {
    note_uid: row.note_uid,
    notebook_id: row.notebook_id,
    relative_path: row.relative_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function getLocalNoteIdentityUidsByNotebook(notebookId: string): Set<string> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT note_uid
    FROM local_note_identity
    WHERE notebook_id = ?
  `).all(notebookId) as Array<{ note_uid: string }>
  return new Set(rows.map((row) => row.note_uid))
}

function getLocalNoteIdentityRowByPath(
  notebookId: string,
  relativePath: string
): LocalNoteIdentityRow | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    WHERE notebook_id = ? AND relative_path = ?
  `).get(notebookId, relativePath) as LocalNoteIdentityRow | undefined
  return row || null
}

function getLocalNoteIdentityRowByUid(noteUid: string): LocalNoteIdentityRow | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    WHERE note_uid = ?
  `).get(noteUid) as LocalNoteIdentityRow | undefined
  return row || null
}

function renameLocalNoteIdentityPathInternal(
  notebookId: string,
  fromRelativePath: string,
  toRelativePath: string
): number {
  const db = getDb()
  if (fromRelativePath === toRelativePath) return 0
  const source = getLocalNoteIdentityRowByPath(notebookId, fromRelativePath)
  if (!source) return 0

  const target = getLocalNoteIdentityRowByPath(notebookId, toRelativePath)
  const now = new Date().toISOString()

  if (target && target.note_uid !== source.note_uid) {
    db.prepare(`
      DELETE FROM local_note_identity
      WHERE note_uid = ?
    `).run(target.note_uid)
  }

  const result = db.prepare(`
    UPDATE local_note_identity
    SET relative_path = ?, updated_at = ?
    WHERE note_uid = ?
  `).run(toRelativePath, now, source.note_uid)
  return result.changes
}

export function listLocalNoteIdentity(input?: { notebookIds?: string[] }): LocalNoteIdentity[] {
  const db = getDb()
  const notebookIds = Array.isArray(input?.notebookIds)
    ? input.notebookIds.map((id) => id.trim()).filter(Boolean)
    : []

  if (notebookIds.length > 0) {
    const placeholders = notebookIds.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE notebook_id IN (${placeholders})
      ORDER BY updated_at DESC
    `).all(...notebookIds) as LocalNoteIdentityRow[]
    return rows.map(rowToLocalNoteIdentity)
  }

  const rows = db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    ORDER BY updated_at DESC
  `).all() as LocalNoteIdentityRow[]
  return rows.map(rowToLocalNoteIdentity)
}

export function getLocalNoteIdentityByPath(input: {
  notebook_id: string
  relative_path: string
}): LocalNoteIdentity | null {
  const notebookId = input.notebook_id?.trim() || ''
  const relativePath = normalizeLocalIdentityRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return null

  const row = getLocalNoteIdentityRowByPath(notebookId, relativePath)
  return row ? rowToLocalNoteIdentity(row) : null
}

export function getLocalNoteIdentityByUid(input: {
  note_uid: string
  notebook_id?: string | null
}): LocalNoteIdentity | null {
  const noteUid = normalizeLocalIdentityUid(input.note_uid || '')
  const notebookId = input.notebook_id?.trim() || null
  if (!noteUid) return null

  const row = getLocalNoteIdentityRowByUid(noteUid)
  if (!row) return null
  if (notebookId && row.notebook_id !== notebookId) return null
  return rowToLocalNoteIdentity(row)
}

export function ensureLocalNoteIdentity(input: {
  notebook_id: string
  relative_path: string
}): LocalNoteIdentity | null {
  const db = getDb()
  const notebookId = input.notebook_id?.trim() || ''
  const relativePath = normalizeLocalIdentityRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return null
  if (!isLocalFolderNotebookId(notebookId)) return null

  const existing = getLocalNoteIdentityRowByPath(notebookId, relativePath)
  if (existing) {
    return rowToLocalNoteIdentity(existing)
  }

  const now = new Date().toISOString()
  const upsertStmt = db.prepare(`
    INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(notebook_id, relative_path) DO UPDATE SET
      updated_at = excluded.updated_at
  `)

  const tx = db.transaction(() => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const generatedUid = uuidv4().toLowerCase()
      if (hasInternalNoteId(generatedUid)) {
        continue
      }
      try {
        upsertStmt.run(generatedUid, notebookId, relativePath, now, now)
        const row = getLocalNoteIdentityRowByPath(notebookId, relativePath)
        return row ? rowToLocalNoteIdentity(row) : null
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (!message.includes('local_note_identity.note_uid')) {
          throw error
        }
      }
    }
    const row = getLocalNoteIdentityRowByPath(notebookId, relativePath)
    return row ? rowToLocalNoteIdentity(row) : null
  })

  return tx()
}

export function renameLocalNoteIdentityPath(input: {
  notebook_id: string
  from_relative_path: string
  to_relative_path: string
}): number {
  const db = getDb()
  const notebookId = input.notebook_id?.trim() || ''
  const fromRelativePath = normalizeLocalIdentityRelativePath(input.from_relative_path || '')
  const toRelativePath = normalizeLocalIdentityRelativePath(input.to_relative_path || '')
  if (!notebookId || !fromRelativePath || !toRelativePath) return 0
  if (fromRelativePath === toRelativePath) return 0

  const tx = db.transaction(() => {
    return renameLocalNoteIdentityPathInternal(notebookId, fromRelativePath, toRelativePath)
  })
  return tx()
}

export function moveLocalNoteIdentity(input: {
  from_notebook_id: string
  from_relative_path: string
  to_notebook_id: string
  to_relative_path: string
}): number {
  const db = getDb()
  const fromNotebookId = input.from_notebook_id?.trim() || ''
  const toNotebookId = input.to_notebook_id?.trim() || ''
  const fromRelativePath = normalizeLocalIdentityRelativePath(input.from_relative_path || '')
  const toRelativePath = normalizeLocalIdentityRelativePath(input.to_relative_path || '')
  if (!fromNotebookId || !toNotebookId || !fromRelativePath || !toRelativePath) return 0

  if (fromNotebookId === toNotebookId) {
    return renameLocalNoteIdentityPath({
      notebook_id: fromNotebookId,
      from_relative_path: fromRelativePath,
      to_relative_path: toRelativePath,
    })
  }

  const tx = db.transaction(() => {
    const source = getLocalNoteIdentityRowByPath(fromNotebookId, fromRelativePath)
    if (!source) return 0

    const target = getLocalNoteIdentityRowByPath(toNotebookId, toRelativePath)
    if (target && target.note_uid !== source.note_uid) {
      db.prepare(`
        DELETE FROM local_note_identity
        WHERE note_uid = ?
      `).run(target.note_uid)
    }

    const now = new Date().toISOString()
    const result = db.prepare(`
      UPDATE local_note_identity
      SET notebook_id = ?, relative_path = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(toNotebookId, toRelativePath, now, source.note_uid)
    return result.changes
  })

  return tx()
}

export function renameLocalNoteIdentityFolderPath(input: {
  notebook_id: string
  from_relative_folder_path: string
  to_relative_folder_path: string
}): number {
  const db = getDb()
  const notebookId = input.notebook_id?.trim() || ''
  const fromFolderPath = normalizeLocalIdentityRelativePath(input.from_relative_folder_path || '')
  const toFolderPath = normalizeLocalIdentityRelativePath(input.to_relative_folder_path || '')
  if (!notebookId || !fromFolderPath || !toFolderPath) return 0
  if (fromFolderPath === toFolderPath) return 0

  const prefixLike = escapeLikePrefix(fromFolderPath)
  const affectedRows = db.prepare(`
    SELECT relative_path
    FROM local_note_identity
    WHERE notebook_id = ?
      AND (relative_path = ? OR relative_path ${LIKE_ESCAPE})
    ORDER BY LENGTH(relative_path) ASC, relative_path ASC
  `).all(notebookId, fromFolderPath, prefixLike) as Array<{ relative_path: string }>

  if (affectedRows.length === 0) return 0

  const tx = db.transaction(() => {
    let changes = 0
    for (const row of affectedRows) {
      const suffix = row.relative_path === fromFolderPath
        ? ''
        : row.relative_path.slice(fromFolderPath.length + 1)
      const nextPath = suffix ? `${toFolderPath}/${suffix}` : toFolderPath
      changes += renameLocalNoteIdentityPathInternal(notebookId, row.relative_path, nextPath)
    }
    return changes
  })

  return tx()
}

export function deleteLocalNoteIdentityByPath(input: {
  notebook_id: string
  relative_path: string
  kind: 'file' | 'folder'
}): number {
  const db = getDb()
  const notebookId = input.notebook_id?.trim() || ''
  const relativePath = normalizeLocalIdentityRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return 0

  if (input.kind === 'file') {
    const result = db.prepare(`
      DELETE FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).run(notebookId, relativePath)
    return result.changes
  }

  const prefixLike = escapeLikePrefix(relativePath)
  const result = db.prepare(`
    DELETE FROM local_note_identity
    WHERE notebook_id = ?
      AND (relative_path = ? OR relative_path ${LIKE_ESCAPE})
  `).run(notebookId, relativePath, prefixLike)
  return result.changes
}
