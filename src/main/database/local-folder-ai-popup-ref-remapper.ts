import { getDb } from './connection'

function shouldRetryAfterAIPopupRefRemapConstraintError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return true
  }

  const message = error instanceof Error ? error.message : String(error)
  return message.includes('UNIQUE constraint failed: ai_popup_refs.popup_id, ai_popup_refs.note_id')
}

export function createLocalFolderAIPopupRefUidRemapper(
  hasAiPopupRefs: boolean
): (fromUid: string, toUid: string) => number {
  if (!hasAiPopupRefs) {
    return () => 0
  }

  const db = getDb()
  const deleteDuplicateLocalPopupRefsByUidStmt = db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE source_type = 'local-folder'
      AND note_id = ?
      AND EXISTS (
        SELECT 1
        FROM ai_popup_refs target
        WHERE target.source_type = 'local-folder'
          AND target.note_id = ?
          AND target.popup_id = ai_popup_refs.popup_id
      )
  `)
  const remapLocalPopupRefsByUidStmt = db.prepare(`
    UPDATE ai_popup_refs
    SET note_id = ?, updated_at = ?
    WHERE source_type = 'local-folder'
      AND note_id = ?
  `)
  const deleteConflictingLocalPopupRefsByAnySourceStmt = db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE source_type = 'local-folder'
      AND note_id = ?
      AND EXISTS (
        SELECT 1
        FROM ai_popup_refs target
        WHERE target.note_id = ?
          AND target.popup_id = ai_popup_refs.popup_id
      )
  `)

  return (fromUid: string, toUid: string): number => {
    if (fromUid === toUid) return 0
    deleteDuplicateLocalPopupRefsByUidStmt.run(fromUid, toUid)
    const updatedAt = new Date().toISOString()
    try {
      return remapLocalPopupRefsByUidStmt.run(toUid, updatedAt, fromUid).changes
    } catch (error) {
      if (!shouldRetryAfterAIPopupRefRemapConstraintError(error)) {
        throw error
      }

      // Legacy/corrupted DB fallback: target note_id might already be occupied by
      // refs from a different source_type due to historical id-space collisions.
      // Keep existing target refs and drop conflicting source refs, then retry.
      deleteConflictingLocalPopupRefsByAnySourceStmt.run(fromUid, toUid)
      return remapLocalPopupRefsByUidStmt.run(toUid, updatedAt, fromUid).changes
    }
  }
}
