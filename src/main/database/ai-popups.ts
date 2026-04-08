import { getDb } from './connection'
import { tableExists } from './helpers'
import { createLocalFolderAIPopupRefUidRemapper } from './local-folder-ai-popup-ref-remapper'
import { extractAIPopupIdsFromTiptapContent } from '../ai-popup-refs'
import { parseRequiredLocalNoteUidInput } from '../local-note-uid'
import type { NotebookSourceType } from '../../shared/types'

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

type AIPopupRefSourceType = NotebookSourceType

function resolveAIPopupRefSourceType(
  sourceType: unknown
): AIPopupRefSourceType {
  if (sourceType === undefined || sourceType === null) {
    throw new Error('ai_popup_refs.source_type is required')
  }

  if (typeof sourceType !== 'string') {
    throw new Error(`invalid ai_popup_refs.source_type: ${String(sourceType)}`)
  }

  if (sourceType === 'internal' || sourceType === 'local-folder') {
    return sourceType
  }

  throw new Error(`invalid ai_popup_refs.source_type: ${sourceType}`)
}

function parseRequiredAIPopupRefNoteId(noteIdInput: unknown): string | null {
  if (typeof noteIdInput !== 'string') return null
  if (!noteIdInput.trim()) return null
  return noteIdInput
}

export function remapLocalFolderAIPopupRefsNoteUid(
  fromNoteUidInput: unknown,
  toNoteUidInput: unknown
): number {
  const fromNoteUid = parseRequiredAIPopupRefNoteId(fromNoteUidInput)
  const toNoteUid = parseRequiredLocalNoteUidInput(toNoteUidInput)
  if (!fromNoteUid || !toNoteUid) return 0
  if (fromNoteUid === toNoteUid) return 0
  if (!tableExists('ai_popup_refs')) return 0

  const db = getDb()
  const remapLocalPopupRefsByUid = createLocalFolderAIPopupRefUidRemapper(true)
  const remapTx = db.transaction((fromUid: string, toUid: string) => {
    return remapLocalPopupRefsByUid(fromUid, toUid)
  })
  return remapTx(fromNoteUid, toNoteUid)
}

function parseRequiredAIPopupRefNoteIdBySourceType(
  noteIdInput: unknown,
  sourceType: AIPopupRefSourceType
): string | null {
  if (sourceType === 'local-folder') {
    const parsedNoteUid = parseRequiredLocalNoteUidInput(noteIdInput)
    if (parsedNoteUid) return parsedNoteUid
    if (typeof noteIdInput === 'string' && noteIdInput.trim()) {
      // Fail fast for explicit-but-invalid local note_uid values (e.g. trim aliases).
      throw new Error('invalid ai_popup_refs.note_reference')
    }
    return null
  }
  return parseRequiredAIPopupRefNoteId(noteIdInput)
}

function normalizeAIPopupRefPopupIds(
  popupIds: readonly string[] | null | undefined
): string[] {
  if (!Array.isArray(popupIds) || popupIds.length === 0) return []
  const normalized = new Set<string>()
  for (const popupId of popupIds) {
    if (typeof popupId !== 'string') continue
    if (!popupId.trim() || popupId.length > 512) continue
    normalized.add(popupId)
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
  return replaceAIPopupRefsForNotesInternal(sourceType, [
    { noteId, popupIds },
  ])
}

function replaceAIPopupRefsForNotesInternal(
  sourceType: AIPopupRefSourceType,
  notes: ReadonlyArray<{
    noteId: string
    popupIds: readonly string[]
  }>
): number {
  const db = getDb()
  const tx = db.transaction((
    normalizedSourceType: AIPopupRefSourceType,
    normalizedNotes: ReadonlyArray<{
      noteId: string
      popupIds: readonly string[]
    }>
  ) => {
    const now = new Date().toISOString()
    const deleteStmt = db.prepare(`
      DELETE FROM ai_popup_refs
      WHERE note_id = ? AND source_type = ?
    `)

    const insertStmt = db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM ai_popups WHERE id = ?)
      ON CONFLICT(popup_id, note_id) DO UPDATE SET
        source_type = excluded.source_type,
        updated_at = excluded.updated_at
    `)

    let inserted = 0
    for (const note of normalizedNotes) {
      deleteStmt.run(note.noteId, normalizedSourceType)
      if (note.popupIds.length === 0) continue
      for (const popupId of note.popupIds) {
        const result = insertStmt.run(
          popupId,
          note.noteId,
          normalizedSourceType,
          now,
          now,
          popupId
        )
        inserted += result.changes
      }
    }
    return inserted
  })

  return tx(sourceType, notes)
}

export function replaceAIPopupRefsForNote(input: {
  note_id: string
  source_type: AIPopupRefSourceType
  popup_ids?: readonly string[] | null
  tiptap_content?: string | null
}): number {
  const sourceType = resolveAIPopupRefSourceType(input.source_type)
  const noteId = parseRequiredAIPopupRefNoteIdBySourceType(input.note_id, sourceType)
  if (!noteId) return 0

  const popupIds = input.popup_ids !== undefined
    ? normalizeAIPopupRefPopupIds(input.popup_ids)
    : collectAIPopupRefsFromContent(input.tiptap_content)

  return replaceAIPopupRefsForNoteInternal(noteId, sourceType, popupIds)
}

export function replaceAIPopupRefsForNotesBatch(input: {
  source_type: AIPopupRefSourceType
  notes: ReadonlyArray<{
    note_id: string
    popup_ids?: readonly string[] | null
    tiptap_content?: string | null
  }>
}): number {
  const sourceType = resolveAIPopupRefSourceType(input.source_type)
  if (!Array.isArray(input.notes) || input.notes.length === 0) return 0

  const normalizedByNoteId = new Map<string, readonly string[]>()
  for (const note of input.notes) {
    const noteId = parseRequiredAIPopupRefNoteIdBySourceType(note.note_id, sourceType)
    if (!noteId) continue
    const popupIds = note.popup_ids !== undefined
      ? normalizeAIPopupRefPopupIds(note.popup_ids)
      : collectAIPopupRefsFromContent(note.tiptap_content)
    normalizedByNoteId.set(noteId, popupIds)
  }

  if (normalizedByNoteId.size === 0) return 0

  const normalizedNotes = Array.from(normalizedByNoteId.entries()).map(([noteId, popupIds]) => ({
    noteId,
    popupIds,
  }))
  return replaceAIPopupRefsForNotesInternal(sourceType, normalizedNotes)
}

export function deleteAIPopupRefsForNote(input: {
  note_id: string
  source_type: AIPopupRefSourceType
}): number {
  const db = getDb()
  const sourceType = resolveAIPopupRefSourceType(input.source_type)
  const noteId = parseRequiredAIPopupRefNoteIdBySourceType(input.note_id, sourceType)
  if (!noteId) return 0

  const result = db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE note_id = ? AND source_type = ?
  `).run(noteId, sourceType)
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
    const selectBatchStmt = db.prepare(`
      SELECT id, content
      FROM notes
      WHERE content LIKE '%aiPopupMark%'
      ORDER BY id
      LIMIT ? OFFSET ?
    `)

    for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
      const batch = selectBatchStmt.all(BATCH_SIZE, offset) as Array<{ id: string; content: string | null }>

      for (const row of batch) {
        const noteId = parseRequiredAIPopupRefNoteIdBySourceType(row.id, 'internal')
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
