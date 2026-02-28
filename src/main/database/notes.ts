import { v4 as uuidv4 } from 'uuid'
import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear'
import isoWeek from 'dayjs/plugin/isoWeek'
import { getDb } from './connection'
import { TRASH_RETENTION_DAYS, hasInternalNoteId, hasLocalNoteUid } from './helpers'
import { replaceAIPopupRefsForNote } from './ai-popups'
import { getDailyDefaultTemplate } from './templates'
import { markdownToTiptapString } from '../markdown'
import type {
  Note,
  NoteInput,
  NoteUpdateSafeFailureReason,
  NoteUpdateSafeResult,
  NoteSearchFilter,
  TagWithSource,
  Notebook,
} from '../../shared/types'

dayjs.extend(weekOfYear)
dayjs.extend(isoWeek)

// Re-import RECENT_DAYS as value (not just type)
import { RECENT_DAYS as RECENT_DAYS_VALUE } from '../../shared/types'

/** Parse tags JSON string from SQL query */
export function parseTags(tagsJson: string | null): TagWithSource[] {
  if (!tagsJson) return []
  try {
    const tags = JSON.parse(tagsJson) as Array<{ id: string; name: string; source: string }>
    return tags.filter(tag => tag.id !== null).map(tag => ({
      id: tag.id,
      name: tag.name,
      source: tag.source === 'ai' ? 'ai' : 'user'
    }))
  } catch {
    return []
  }
}

/** SQL subquery for aggregating tags as JSON */
const TAGS_SUBQUERY = `(
  SELECT JSON_GROUP_ARRAY(JSON_OBJECT('id', t.id, 'name', t.name, 'source', COALESCE(nt.source, 'user')))
  FROM note_tags nt
  JOIN tags t ON t.id = nt.tag_id
  WHERE nt.note_id = n.id
) as tags_json`

/** Common SELECT columns for Note queries */
export const NOTE_SELECT_COLUMNS = `n.id, n.title, n.content, n.notebook_id, n.folder_path, n.is_daily, n.daily_date,
  n.is_favorite, n.is_pinned, n.revision, n.created_at, n.updated_at, n.deleted_at, n.ai_summary,
  ${TAGS_SUBQUERY}`

/** Convert database row to Note object */
export function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    notebook_id: row.notebook_id as string | null,
    folder_path: row.folder_path as string | null,
    is_daily: Boolean(row.is_daily),
    daily_date: row.daily_date as string | null,
    is_favorite: Boolean(row.is_favorite),
    is_pinned: Boolean(row.is_pinned),
    revision: Number(row.revision ?? 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: row.deleted_at as string | null,
    ai_summary: row.ai_summary as string | null,
    tags: parseTags(row.tags_json as string | null),
  }
}

export function getNotes(limit = -1, offset = 0): Note[] {
  const db = getDb()
  // SQLite LIMIT -1 means no limit (returns all rows)
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.deleted_at IS NULL
    ORDER BY n.is_pinned DESC, n.updated_at DESC
    LIMIT ? OFFSET ?
  `)
  return stmt.all(limit, offset).map(row => rowToNote(row as Record<string, unknown>))
}

export function getNotesByUpdated(limit = -1, offset = 0): Note[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
    LIMIT ? OFFSET ?
  `)
  return stmt.all(limit, offset).map(row => rowToNote(row as Record<string, unknown>))
}

export function getNoteById(id: string): Note | null {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.id = ?
  `)
  const row = stmt.get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToNote(row)
}

export function getNotesByIds(ids: string[]): Note[] {
  const db = getDb()
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(',')
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.id IN (${placeholders})
  `)
  const rows = stmt.all(...ids) as Array<Record<string, unknown>>

  const noteMap = new Map(rows.map(row => [row.id as string, row]))
  return ids
    .map(id => noteMap.get(id))
    .filter((row): row is Record<string, unknown> => row !== undefined)
    .map(rowToNote)
}

function resolveNoteNotebookAssignment(
  notebookId: string | null | undefined
): { ok: true } | { ok: false; error: Extract<NoteUpdateSafeFailureReason, 'notebook_not_found' | 'target_not_allowed'> } {
  const db = getDb()
  if (notebookId === undefined || notebookId === null) {
    return { ok: true }
  }

  const notebook = db.prepare('SELECT id, source_type FROM notebooks WHERE id = ?').get(notebookId) as
    | { id: string; source_type: Notebook['source_type'] | null }
    | undefined
  if (!notebook) {
    return { ok: false, error: 'notebook_not_found' }
  }

  if ((notebook.source_type || 'internal') === 'local-folder') {
    return { ok: false, error: 'target_not_allowed' }
  }

  return { ok: true }
}

function canAssignNoteToNotebook(notebookId: string | null | undefined): boolean {
  return resolveNoteNotebookAssignment(notebookId).ok
}

function hasMeaningfulNoteChange(existing: Note, updates: Partial<NoteInput>): boolean {
  return (
    (updates.title !== undefined && updates.title !== existing.title)
    || (updates.content !== undefined && updates.content !== existing.content)
    || (updates.notebook_id !== undefined && updates.notebook_id !== existing.notebook_id)
    || (updates.folder_path !== undefined && updates.folder_path !== existing.folder_path)
    || (updates.is_daily !== undefined && Boolean(updates.is_daily) !== existing.is_daily)
    || (updates.daily_date !== undefined && updates.daily_date !== existing.daily_date)
    || (updates.is_favorite !== undefined && Boolean(updates.is_favorite) !== existing.is_favorite)
    || (updates.is_pinned !== undefined && Boolean(updates.is_pinned) !== existing.is_pinned)
  )
}

export function addNote(input: NoteInput): Note {
  const db = getDb()
  if (!canAssignNoteToNotebook(input.notebook_id)) {
    throw new Error(`Cannot assign note to notebook: ${input.notebook_id ?? 'null'}`)
  }

  let id = ''
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = uuidv4().toLowerCase()
    if (hasLocalNoteUid(candidate) || hasInternalNoteId(candidate)) {
      continue
    }
    id = candidate
    break
  }
  if (!id) {
    id = uuidv4().toLowerCase()
  }
  const now = new Date().toISOString()

  const insertAndReplaceRefs = db.transaction(() => {
    db.prepare(`
      INSERT INTO notes (id, title, content, notebook_id, folder_path, is_daily, daily_date, is_favorite, is_pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title,
      input.content,
      input.notebook_id ?? null,
      input.folder_path ?? null,
      input.is_daily ? 1 : 0,
      input.daily_date ?? null,
      input.is_favorite ? 1 : 0,
      input.is_pinned ? 1 : 0,
      now,
      now
    )

    replaceAIPopupRefsForNote({
      note_id: id,
      source_type: 'internal',
      tiptap_content: input.content,
    })
  })
  insertAndReplaceRefs()

  const note = getNoteById(id)
  if (!note) throw new Error(`Failed to create note with id ${id}`)
  return note
}

export function updateNote(id: string, updates: Partial<NoteInput>): Note | null {
  const db = getDb()
  const existing = getNoteById(id)
  if (!existing) return null

  if (updates.notebook_id !== undefined && !canAssignNoteToNotebook(updates.notebook_id)) {
    return null
  }

  if (!hasMeaningfulNoteChange(existing, updates)) {
    return existing
  }

  const nextContent = updates.content ?? existing.content
  const nextNotebookId = updates.notebook_id !== undefined ? updates.notebook_id : existing.notebook_id
  const nextFolderPath = updates.folder_path !== undefined ? updates.folder_path : existing.folder_path
  const nextIsDaily = updates.is_daily !== undefined ? (updates.is_daily ? 1 : 0) : (existing.is_daily ? 1 : 0)
  const nextDailyDate = updates.daily_date !== undefined ? updates.daily_date : existing.daily_date
  const nextIsFavorite = updates.is_favorite !== undefined ? (updates.is_favorite ? 1 : 0) : (existing.is_favorite ? 1 : 0)
  const nextIsPinned = updates.is_pinned !== undefined ? (updates.is_pinned ? 1 : 0) : (existing.is_pinned ? 1 : 0)

  const now = new Date().toISOString()
  const updateAndReplaceRefs = db.transaction(() => {
    db.prepare(`
      UPDATE notes
      SET title = ?, content = ?, notebook_id = ?, folder_path = ?, is_daily = ?, daily_date = ?, is_favorite = ?, is_pinned = ?, updated_at = ?, revision = revision + 1
      WHERE id = ?
    `).run(
      updates.title ?? existing.title,
      nextContent,
      nextNotebookId,
      nextFolderPath,
      nextIsDaily,
      nextDailyDate,
      nextIsFavorite,
      nextIsPinned,
      now,
      id
    )

    replaceAIPopupRefsForNote({
      note_id: id,
      source_type: 'internal',
      tiptap_content: nextContent,
    })
  })
  updateAndReplaceRefs()

  return getNoteById(id)
}

export function updateNoteSafe(id: string, updates: Partial<NoteInput>, expectedRevision: number): NoteUpdateSafeResult {
  const db = getDb()
  const existing = getNoteById(id)
  if (!existing) return { status: 'failed', error: 'note_not_found' }

  if (updates.notebook_id !== undefined) {
    const assignmentResult = resolveNoteNotebookAssignment(updates.notebook_id)
    if (!assignmentResult.ok) {
      return { status: 'failed', error: assignmentResult.error }
    }
  }

  if (!hasMeaningfulNoteChange(existing, updates)) {
    if (expectedRevision !== existing.revision) {
      return { status: 'conflict', current: existing }
    }
    return { status: 'updated', note: existing }
  }

  const nextContent = updates.content ?? existing.content
  const nextNotebookId = updates.notebook_id !== undefined ? updates.notebook_id : existing.notebook_id
  const nextFolderPath = updates.folder_path !== undefined ? updates.folder_path : existing.folder_path
  const nextIsDaily = updates.is_daily !== undefined ? (updates.is_daily ? 1 : 0) : (existing.is_daily ? 1 : 0)
  const nextDailyDate = updates.daily_date !== undefined ? updates.daily_date : existing.daily_date
  const nextIsFavorite = updates.is_favorite !== undefined ? (updates.is_favorite ? 1 : 0) : (existing.is_favorite ? 1 : 0)
  const nextIsPinned = updates.is_pinned !== undefined ? (updates.is_pinned ? 1 : 0) : (existing.is_pinned ? 1 : 0)

  const now = new Date().toISOString()
  const updateSafeAndReplaceRefs = db.transaction(() => {
    const result = db.prepare(`
      UPDATE notes
      SET title = ?, content = ?, notebook_id = ?, folder_path = ?, is_daily = ?, daily_date = ?, is_favorite = ?, is_pinned = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND revision = ?
    `).run(
      updates.title ?? existing.title,
      nextContent,
      nextNotebookId,
      nextFolderPath,
      nextIsDaily,
      nextDailyDate,
      nextIsFavorite,
      nextIsPinned,
      now,
      id,
      expectedRevision
    )

    if (result.changes > 0) {
      replaceAIPopupRefsForNote({
        note_id: id,
        source_type: 'internal',
        tiptap_content: nextContent,
      })
    }
    return result.changes
  })
  const changes = updateSafeAndReplaceRefs()

  if (changes > 0) {
    const updated = getNoteById(id)
    if (!updated) return { status: 'failed', error: 'note_not_found' }
    return { status: 'updated', note: updated }
  }

  const current = getNoteById(id)
  if (!current) return { status: 'failed', error: 'note_not_found' }
  return { status: 'conflict', current }
}

// Soft delete - move to trash
export function deleteNote(id: string): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
  const result = stmt.run(now, id)
  return result.changes > 0
}

// Get all notes in trash
export function getTrashNotes(): Note[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.deleted_at IS NOT NULL
    ORDER BY n.deleted_at DESC
  `)
  return stmt.all().map(row => rowToNote(row as Record<string, unknown>))
}

// Restore note from trash
export function restoreNote(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('UPDATE notes SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
  const result = stmt.run(id)
  return result.changes > 0
}

// Permanently delete note
export function permanentlyDeleteNote(id: string): boolean {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM notes WHERE id = ?')
  const result = stmt.run(id)
  return result.changes > 0
}

// Empty trash (delete all notes in trash)
export function emptyTrash(): number {
  const db = getDb()
  const stmt = db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL')
  const result = stmt.run()
  return result.changes
}

// Auto cleanup: delete notes that have been in trash for more than TRASH_RETENTION_DAYS
export function cleanupOldTrash(): number {
  const db = getDb()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - TRASH_RETENTION_DAYS)

  const stmt = db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?')
  const result = stmt.run(cutoffDate.toISOString())
  return result.changes
}

export function searchNotes(
  query: string,
  filter?: NoteSearchFilter,
  limit = 100,
  offset = 0
): Note[] {
  const db = getDb()
  if (!query.trim()) return []

  const escaped = query.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const likeQuery = `%${escaped}%`
  const actualLimit = Math.min(limit, 100)

  const conditions: string[] = [
    'n.deleted_at IS NULL',
    `(n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\' OR n.ai_summary LIKE ? ESCAPE '\\')`
  ]
  const params: (string | number)[] = [likeQuery, likeQuery, likeQuery]

  if (filter?.notebookId) {
    conditions.push('n.notebook_id = ?')
    conditions.push('n.is_daily = 0')
    params.push(filter.notebookId)
  } else if (filter?.viewType) {
    switch (filter.viewType) {
      case 'daily':
        conditions.push('n.is_daily = 1')
        break
      case 'favorites':
        conditions.push('n.is_favorite = 1')
        break
      case 'recent': {
        const recentThreshold = new Date(Date.now() - RECENT_DAYS_VALUE * 24 * 60 * 60 * 1000).toISOString()
        conditions.push('n.is_daily = 0')
        conditions.push('n.updated_at > ?')
        params.push(recentThreshold)
        break
      }
      case 'all':
      default:
        conditions.push('n.is_daily = 0')
        break
    }
  }

  const sql = `
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE ${conditions.join(' AND ')}
    ORDER BY n.is_pinned DESC, n.updated_at DESC
    LIMIT ? OFFSET ?
  `
  params.push(actualLimit, offset)

  const stmt = db.prepare(sql)
  return stmt.all(...params).map(row =>
    rowToNote(row as Record<string, unknown>)
  )
}

// Daily Notes

export function getDailyByDate(date: string): Note | null {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    WHERE n.deleted_at IS NULL AND n.is_daily = 1 AND n.daily_date = ?
  `)
  const row = stmt.get(date)
  if (!row) return null
  return rowToNote(row as Record<string, unknown>)
}

/**
 * Parse template variables in text
 */
function parseTemplateVariables(
  text: string,
  context: { title: string; dailyDate?: string }
): string {
  const now = dayjs()
  const dailyDate = context.dailyDate ? dayjs(context.dailyDate) : now

  return text.replace(/\{\{(\w+)([+-]\d+)?(?::([^}]+))?\}\}/g, (match, variable, offset, format) => {
    const varLower = variable.toLowerCase()
    const offsetDays = offset ? parseInt(offset, 10) : 0

    switch (varLower) {
      case 'title':
        return context.title || ''
      case 'notebook':
        return ''
      case 'date': {
        const targetDate = offsetDays !== 0 ? now.add(offsetDays, 'day') : now
        return targetDate.format(format || 'YYYY-MM-DD')
      }
      case 'time':
        return now.format(format || 'HH:mm')
      case 'datetime':
        return now.format(format || 'YYYY-MM-DD HH:mm')
      case 'week':
        return now.format(format || 'WW')
      case 'yesterday':
        return now.subtract(1, 'day').format(format || 'YYYY-MM-DD')
      case 'tomorrow':
        return now.add(1, 'day').format(format || 'YYYY-MM-DD')
      case 'daily_date': {
        const targetDate = offsetDays !== 0 ? dailyDate.add(offsetDays, 'day') : dailyDate
        return targetDate.format(format || 'YYYY-MM-DD')
      }
      case 'daily_yesterday':
        return dailyDate.subtract(1, 'day').format(format || 'YYYY-MM-DD')
      case 'daily_tomorrow':
        return dailyDate.add(1, 'day').format(format || 'YYYY-MM-DD')
      case 'daily_week':
        return dailyDate.format(format || 'WW')
      case 'cursor':
        return '\u2063'
      default:
        return match
    }
  })
}

function parseTemplateContent(
  markdownContent: string,
  context: { title: string; dailyDate?: string }
): string {
  return parseTemplateVariables(markdownContent, context)
}

export function createDaily(date: string, title?: string): Note {
  const existing = getDailyByDate(date)
  if (existing) return existing

  const dailyTemplate = getDailyDefaultTemplate()
  let content = '[]'

  if (dailyTemplate) {
    const markdown = parseTemplateContent(dailyTemplate.content, {
      title: title || '',
      dailyDate: date,
    })
    content = markdownToTiptapString(markdown)
  }

  return addNote({
    title: title || '',
    content,
    is_daily: true,
    daily_date: date,
    is_favorite: false
  })
}

// Note Links (Backlinks)

export function addNoteLink(sourceNoteId: string, targetNoteId: string): void {
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO note_links (source_note_id, target_note_id) VALUES (?, ?)')
    .run(sourceNoteId, targetNoteId)
}

export function removeNoteLink(sourceNoteId: string, targetNoteId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM note_links WHERE source_note_id = ? AND target_note_id = ?')
    .run(sourceNoteId, targetNoteId)
}

export function getBacklinks(noteId: string): Note[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    JOIN note_links nl ON nl.source_note_id = n.id
    WHERE nl.target_note_id = ? AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
  `)
  return stmt.all(noteId).map(row => rowToNote(row as Record<string, unknown>))
}

export function getOutgoingLinks(noteId: string): Note[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT ${NOTE_SELECT_COLUMNS}
    FROM notes n
    JOIN note_links nl ON nl.target_note_id = n.id
    WHERE nl.source_note_id = ? AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
  `)
  return stmt.all(noteId).map(row => rowToNote(row as Record<string, unknown>))
}

export function updateNoteLinks(noteId: string, targetNoteIds: string[]): void {
  const db = getDb()
  const deleteStmt = db.prepare('DELETE FROM note_links WHERE source_note_id = ?')
  const insertStmt = db.prepare('INSERT OR IGNORE INTO note_links (source_note_id, target_note_id) VALUES (?, ?)')

  db.transaction(() => {
    deleteStmt.run(noteId)
    for (const targetId of targetNoteIds) {
      insertStmt.run(noteId, targetId)
    }
  })()
}

// Attachment References

export function getUsedAttachmentPaths(): string[] {
  const db = getDb()
  const paths = new Set<string>()

  // Use iterate() to avoid loading all note content into memory at once.
  // Skip trashed notes since their attachments can be cleaned up.
  const stmt = db.prepare('SELECT content FROM notes WHERE deleted_at IS NULL')
  for (const row of stmt.iterate() as IterableIterator<{ content: string }>) {
    if (!row.content) continue

    const attachmentUrlRegex = /attachment:\/\/([^"'\s)]+)/g
    let match
    while ((match = attachmentUrlRegex.exec(row.content)) !== null) {
      paths.add(match[1])
    }

    const srcRegex = /"src"\s*:\s*"(attachments\/[^"]+)"/g
    while ((match = srcRegex.exec(row.content)) !== null) {
      paths.add(match[1])
    }
  }

  return Array.from(paths)
}
