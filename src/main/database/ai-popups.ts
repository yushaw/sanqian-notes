import { getDb } from './connection'
import { extractAIPopupIdsFromTiptapContent } from '../ai-popup-refs'

export interface PopupData {
  id: string
  content: string
  prompt: string
  actionName: string
  targetText: string
  documentTitle: string
  createdAt: string
  updatedAt: string
}

export interface PopupInput {
  id: string
  prompt: string
  actionName?: string
  targetText: string
  documentTitle?: string
}

type AIPopupRefSourceType = 'internal' | 'local-folder'

function normalizeAIPopupRefSourceType(sourceType: string | null | undefined): AIPopupRefSourceType {
  return sourceType === 'local-folder' ? 'local-folder' : 'internal'
}

function normalizeAIPopupRefNoteId(noteId: string | null | undefined): string {
  return (noteId || '').trim()
}

function normalizeAIPopupRefPopupIds(
  popupIds: readonly string[] | null | undefined
): string[] {
  if (!Array.isArray(popupIds) || popupIds.length === 0) return []
  const normalized = new Set<string>()
  for (const popupId of popupIds) {
    if (typeof popupId !== 'string') continue
    const trimmed = popupId.trim()
    if (!trimmed || trimmed.length > 512) continue
    normalized.add(trimmed)
  }
  return Array.from(normalized)
}

function collectAIPopupRefsFromContent(tiptapContent: string | null | undefined): string[] {
  if (!tiptapContent || !tiptapContent.includes('aiPopupMark')) return []
  return normalizeAIPopupRefPopupIds(extractAIPopupIdsFromTiptapContent(tiptapContent))
}

function replaceAIPopupRefsForNoteInternal(
  noteId: string,
  sourceType: AIPopupRefSourceType,
  popupIds: readonly string[]
): number {
  const db = getDb()
  const tx = db.transaction((normalizedNoteId: string, normalizedSourceType: AIPopupRefSourceType, normalizedPopupIds: readonly string[]) => {
    const now = new Date().toISOString()
    db.prepare(`
      DELETE FROM ai_popup_refs
      WHERE note_id = ? AND source_type = ?
    `).run(normalizedNoteId, normalizedSourceType)

    if (normalizedPopupIds.length === 0) {
      return 0
    }

    const insertStmt = db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM ai_popups WHERE id = ?)
      ON CONFLICT(popup_id, note_id) DO UPDATE SET
        source_type = excluded.source_type,
        updated_at = excluded.updated_at
    `)

    let inserted = 0
    for (const popupId of normalizedPopupIds) {
      const result = insertStmt.run(
        popupId,
        normalizedNoteId,
        normalizedSourceType,
        now,
        now,
        popupId
      )
      inserted += result.changes
    }
    return inserted
  })

  return tx(noteId, sourceType, popupIds)
}

export function replaceAIPopupRefsForNote(input: {
  note_id: string
  source_type?: AIPopupRefSourceType | null
  popup_ids?: readonly string[] | null
  tiptap_content?: string | null
}): number {
  const noteId = normalizeAIPopupRefNoteId(input.note_id)
  if (!noteId) return 0

  const sourceType = normalizeAIPopupRefSourceType(input.source_type || undefined)
  const popupIds = input.popup_ids !== undefined
    ? normalizeAIPopupRefPopupIds(input.popup_ids)
    : collectAIPopupRefsFromContent(input.tiptap_content)

  return replaceAIPopupRefsForNoteInternal(noteId, sourceType, popupIds)
}

export function deleteAIPopupRefsForNote(input: {
  note_id: string
  source_type?: AIPopupRefSourceType | null
}): number {
  const db = getDb()
  const noteId = normalizeAIPopupRefNoteId(input.note_id)
  if (!noteId) return 0

  if (input.source_type) {
    const sourceType = normalizeAIPopupRefSourceType(input.source_type)
    const result = db.prepare(`
      DELETE FROM ai_popup_refs
      WHERE note_id = ? AND source_type = ?
    `).run(noteId, sourceType)
    return result.changes
  }

  const result = db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE note_id = ?
  `).run(noteId)
  return result.changes
}

export function rebuildAIPopupRefsForInternalNotes(): number {
  const db = getDb()
  const BATCH_SIZE = 200

  const countRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM notes WHERE content LIKE '%aiPopupMark%'
  `).get() as { cnt: number }
  const totalCount = countRow?.cnt ?? 0
  if (totalCount === 0) {
    db.prepare(`DELETE FROM ai_popup_refs WHERE source_type = 'internal'`).run()
    return 0
  }

  const now = new Date().toISOString()
  let inserted = 0

  const rebuildTx = db.transaction(() => {
    db.prepare(`DELETE FROM ai_popup_refs WHERE source_type = 'internal'`).run()

    const insertStmt = db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      SELECT ?, ?, 'internal', ?, ?
      WHERE EXISTS (SELECT 1 FROM ai_popups WHERE id = ?)
      ON CONFLICT(popup_id, note_id) DO UPDATE SET
        source_type = 'internal',
        updated_at = excluded.updated_at
    `)

    for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
      const batch = db.prepare(`
        SELECT id, content
        FROM notes
        WHERE content LIKE '%aiPopupMark%'
        ORDER BY id
        LIMIT ? OFFSET ?
      `).all(BATCH_SIZE, offset) as Array<{ id: string; content: string | null }>

      for (const row of batch) {
        const noteId = normalizeAIPopupRefNoteId(row.id)
        if (!noteId) continue
        const popupIds = collectAIPopupRefsFromContent(row.content)
        for (const popupId of popupIds) {
          const result = insertStmt.run(popupId, noteId, now, now, popupId)
          inserted += result.changes
        }
      }
    }
  })

  rebuildTx()
  return inserted
}

export function getPopup(id: string): PopupData | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM ai_popups WHERE id = ?').get(id) as {
    id: string
    content: string
    prompt: string
    action_name: string
    target_text: string
    document_title: string
    created_at: string
    updated_at: string
  } | undefined

  if (!row) return null

  return {
    id: row.id,
    content: row.content,
    prompt: row.prompt,
    actionName: row.action_name,
    targetText: row.target_text,
    documentTitle: row.document_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function createPopup(input: PopupInput): PopupData {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
    VALUES (?, '', ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.prompt,
    input.actionName || '',
    input.targetText,
    input.documentTitle || '',
    now,
    now
  )

  return getPopup(input.id)!
}

export function updatePopupContent(id: string, content: string): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const result = db.prepare('UPDATE ai_popups SET content = ?, updated_at = ? WHERE id = ?').run(content, now, id)
  return result.changes > 0
}

export function deletePopup(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM ai_popups WHERE id = ?').run(id)
  return result.changes > 0
}

export function cleanupPopups(maxAgeDays = 30): number {
  const db = getDb()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays)
  const cutoffStr = cutoffDate.toISOString()

  db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE popup_id NOT IN (SELECT id FROM ai_popups)
  `).run()

  const result = db.prepare(`
    DELETE FROM ai_popups
    WHERE created_at < ?
      AND NOT EXISTS (
        SELECT 1
        FROM ai_popup_refs refs
        WHERE refs.popup_id = ai_popups.id
      )
  `).run(cutoffStr)
  return result.changes
}
