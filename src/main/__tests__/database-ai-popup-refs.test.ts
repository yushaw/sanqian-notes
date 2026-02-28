import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNote,
  addNotebook,
  cleanupPopups,
  closeDatabase,
  createPopup,
  deleteAIPopupRefsForNote,
  deleteLocalNoteIdentityByPath,
  ensureLocalNoteIdentity,
  getPopup,
  initDatabase,
  rebuildAIPopupRefsForInternalNotes,
  replaceAIPopupRefsForNote,
  updateNote,
} from '../database'

const require = createRequire(import.meta.url)
let sqliteAvailable = false

try {
  const BetterSqlite = require('better-sqlite3')
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[Database AI Popup Ref Tests] better-sqlite3 unavailable, skipping tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database AI Popup Ref Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

function removeDbFiles(dir: string): void {
  rmSync(join(dir, 'notes.db'), { force: true })
  rmSync(join(dir, 'notes.db-wal'), { force: true })
  rmSync(join(dir, 'notes.db-shm'), { force: true })
}

function buildPopupMarkedDoc(popupId: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Explain this' },
          { type: 'aiPopupMark', attrs: { popupId } },
        ],
      },
    ],
  })
}

describeSqlite('database ai_popup_refs', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-ai-popup-refs-'))

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    closeDatabase()
    removeDbFiles(testDbDir)
    initDatabase()
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('keeps referenced popups and removes unreferenced ones for internal notes', () => {
    const popupId = 'popup-internal-1'
    createPopup({
      id: popupId,
      prompt: 'Explain',
      targetText: 'target',
      actionName: 'Explain',
    })

    const note = addNote({
      title: 'Internal Note',
      content: buildPopupMarkedDoc(popupId),
    })

    expect(cleanupPopups(-1)).toBe(0)
    expect(getPopup(popupId)).not.toBeNull()

    const updated = updateNote(note.id, {
      content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'No popup now' }] }] }),
    })
    expect(updated).not.toBeNull()

    expect(cleanupPopups(-1)).toBe(1)
    expect(getPopup(popupId)).toBeNull()
  })

  it('rebuilds internal popup refs from note content before cleanup', () => {
    const popupId = 'popup-internal-rebuild-1'
    createPopup({
      id: popupId,
      prompt: 'Explain',
      targetText: 'target',
      actionName: 'Explain',
    })
    const note = addNote({
      title: 'Internal Rebuild',
      content: buildPopupMarkedDoc(popupId),
    })

    deleteAIPopupRefsForNote({ note_id: note.id, source_type: 'internal' })
    expect(cleanupPopups(-1)).toBe(1)
    expect(getPopup(popupId)).toBeNull()

    createPopup({
      id: popupId,
      prompt: 'Explain',
      targetText: 'target',
      actionName: 'Explain',
    })
    rebuildAIPopupRefsForInternalNotes()
    expect(cleanupPopups(-1)).toBe(0)
    expect(getPopup(popupId)).not.toBeNull()
  })

  it('cleans up local-folder popup refs when local identity is removed', () => {
    const localNotebook = addNotebook({ name: 'Local', source_type: 'local-folder' })
    const localIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/local.md',
    })
    expect(localIdentity).not.toBeNull()

    const popupId = 'popup-local-1'
    createPopup({
      id: popupId,
      prompt: 'Explain local',
      targetText: 'local target',
      actionName: 'Explain',
    })

    replaceAIPopupRefsForNote({
      note_id: localIdentity?.note_uid || '',
      source_type: 'local-folder',
      tiptap_content: buildPopupMarkedDoc(popupId),
    })

    expect(cleanupPopups(-1)).toBe(0)
    expect(getPopup(popupId)).not.toBeNull()

    const deleted = deleteLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/local.md',
      kind: 'file',
    })
    expect(deleted).toBe(1)

    expect(cleanupPopups(-1)).toBe(1)
    expect(getPopup(popupId)).toBeNull()
  })
})
