import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNote,
  addNotesBatch,
  cleanupPopups,
  closeDatabase,
  createLocalFolderNotebookMount,
  createPopup,
  deleteAIPopupRefsForNote,
  deleteLocalNoteIdentityByPath,
  ensureLocalNoteIdentity,
  getPopup,
  initDatabase,
  rebuildAIPopupRefsForInternalNotes,
  replaceAIPopupRefsForNote,
  replaceAIPopupRefsForNotesBatch,
  updateNote,
} from '../database'
import { remapLocalFolderAIPopupRefsNoteUid } from '../database/ai-popups'
import { getDb } from '../database/connection'

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
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local',
    }).notebook
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

  it('replaces popup refs for multiple local-folder notes in one batch', () => {
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local Batch',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-batch',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-batch',
    }).notebook
    const localA = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    const localB = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
    })
    expect(localA?.note_uid).toBeTruthy()
    expect(localB?.note_uid).toBeTruthy()

    const popup1 = 'popup-local-batch-1'
    const popup2 = 'popup-local-batch-2'
    const popup3 = 'popup-local-batch-3'
    createPopup({ id: popup1, prompt: 'p1', targetText: 't1', actionName: 'Explain' })
    createPopup({ id: popup2, prompt: 'p2', targetText: 't2', actionName: 'Explain' })
    createPopup({ id: popup3, prompt: 'p3', targetText: 't3', actionName: 'Explain' })

    const inserted = replaceAIPopupRefsForNotesBatch({
      source_type: 'local-folder',
      notes: [
        { note_id: localA?.note_uid || '', tiptap_content: buildPopupMarkedDoc(popup1) },
        { note_id: localB?.note_uid || '', popup_ids: [popup2] },
        { note_id: localA?.note_uid || '', popup_ids: [popup3] },
      ],
    })
    expect(inserted).toBeGreaterThanOrEqual(2)

    const db = getDb()
    const refsA = db.prepare(`
      SELECT popup_id
      FROM ai_popup_refs
      WHERE note_id = ? AND source_type = 'local-folder'
      ORDER BY popup_id
    `).all(localA?.note_uid || '') as Array<{ popup_id: string }>
    const refsB = db.prepare(`
      SELECT popup_id
      FROM ai_popup_refs
      WHERE note_id = ? AND source_type = 'local-folder'
      ORDER BY popup_id
    `).all(localB?.note_uid || '') as Array<{ popup_id: string }>

    expect(refsA.map((row) => row.popup_id)).toEqual([popup3])
    expect(refsB.map((row) => row.popup_id)).toEqual([popup2])
  })

  it('batch replace is transactional when one local note reference is invalid', () => {
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local Batch Rollback',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-batch-rollback',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-batch-rollback',
    }).notebook
    const localA = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(localA?.note_uid).toBeTruthy()

    const popup1 = 'popup-local-batch-rollback-1'
    const popup2 = 'popup-local-batch-rollback-2'
    createPopup({ id: popup1, prompt: 'p1', targetText: 't1', actionName: 'Explain' })
    createPopup({ id: popup2, prompt: 'p2', targetText: 't2', actionName: 'Explain' })

    expect(() => {
      replaceAIPopupRefsForNotesBatch({
        source_type: 'local-folder',
        notes: [
          { note_id: localA?.note_uid || '', popup_ids: [popup1] },
          { note_id: 'uid-missing-reference', popup_ids: [popup2] },
        ],
      })
    }).toThrow('invalid ai_popup_refs.note_reference')

    const db = getDb()
    const count = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM ai_popup_refs
      WHERE source_type = 'local-folder'
    `).get() as { cnt: number }
    expect(count.cnt).toBe(0)
  })

  it('remaps local-folder popup refs by note uid without creating duplicates', () => {
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local Remap',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap',
    }).notebook
    const fromIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/from.md',
    })
    const toIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/to.md',
    })
    expect(fromIdentity?.note_uid).toBeTruthy()
    expect(toIdentity?.note_uid).toBeTruthy()
    if (!fromIdentity?.note_uid || !toIdentity?.note_uid) return

    const popupA = 'popup-remap-a'
    const popupB = 'popup-remap-b'
    createPopup({ id: popupA, prompt: 'pa', targetText: 'ta', actionName: 'Explain' })
    createPopup({ id: popupB, prompt: 'pb', targetText: 'tb', actionName: 'Explain' })

    const db = getDb()
    const oldTs = '2020-01-01T00:00:00.000Z'
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run(popupA, fromIdentity.note_uid, oldTs, oldTs)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run(popupA, toIdentity.note_uid, oldTs, oldTs)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run(popupB, fromIdentity.note_uid, oldTs, oldTs)

    const remapped = remapLocalFolderAIPopupRefsNoteUid(fromIdentity.note_uid, toIdentity.note_uid)
    expect(remapped).toBe(1)

    const fromRefsCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = ?
    `).get(fromIdentity.note_uid) as { count: number }
    expect(fromRefsCount.count).toBe(0)

    const toRefs = db.prepare(`
      SELECT popup_id, updated_at
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = ?
      ORDER BY popup_id
    `).all(toIdentity.note_uid) as Array<{ popup_id: string; updated_at: string }>
    expect(toRefs.map((row) => row.popup_id)).toEqual([popupA, popupB])
    expect(toRefs.find((row) => row.popup_id === popupB)?.updated_at).not.toBe(oldTs)
  })

  it('drops conflicting source refs when remap target is occupied by non-local source rows', () => {
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local Remap Cross Source Conflict',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap-cross-source-conflict',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap-cross-source-conflict',
    }).notebook
    const fromIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/from.md',
    })
    const toIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/to.md',
    })
    expect(fromIdentity?.note_uid).toBeTruthy()
    expect(toIdentity?.note_uid).toBeTruthy()
    if (!fromIdentity?.note_uid || !toIdentity?.note_uid) return

    const db = getDb()
    const popupId = 'popup-remap-cross-source-conflict'
    const toNoteUid = toIdentity.note_uid
    const now = new Date().toISOString()

    // Simulate legacy corrupted state where an internal note id collides with a
    // local-folder note_uid before strict cross-table conflict triggers existed.
    db.exec('DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_insert')

    createPopup({ id: popupId, prompt: 'conflict', targetText: 'target', actionName: 'Explain' })
    db.prepare(`
      INSERT INTO notes (id, title, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(toNoteUid, 'Synthetic Internal Target', JSON.stringify({ type: 'doc', content: [] }), now, now)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'internal', ?, ?)
    `).run(popupId, toNoteUid, now, now)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run(popupId, fromIdentity.note_uid, now, now)

    const remapped = remapLocalFolderAIPopupRefsNoteUid(fromIdentity.note_uid, toNoteUid)
    expect(remapped).toBe(0)

    const sourceCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = ?
    `).get(fromIdentity.note_uid) as { count: number }
    expect(sourceCount.count).toBe(0)

    const targetRow = db.prepare(`
      SELECT source_type
      FROM ai_popup_refs
      WHERE popup_id = ? AND note_id = ?
      LIMIT 1
    `).get(popupId, toNoteUid) as { source_type: string } | undefined
    expect(targetRow?.source_type).toBe('internal')
  })

  it('keeps source refs when remap target local uid is missing', () => {
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local Remap Missing Target Guard',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap-missing-target-guard',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap-missing-target-guard',
    }).notebook
    const fromIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/from.md',
    })
    const toIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/to.md',
    })
    expect(fromIdentity?.note_uid).toBeTruthy()
    expect(toIdentity?.note_uid).toBeTruthy()
    if (!fromIdentity?.note_uid || !toIdentity?.note_uid) return

    const db = getDb()
    const popupId = 'popup-remap-missing-target-guard'
    const now = new Date().toISOString()

    createPopup({ id: popupId, prompt: 'guard', targetText: 'target', actionName: 'Explain' })
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run(popupId, fromIdentity.note_uid, now, now)

    db.prepare(`
      DELETE FROM local_note_identity
      WHERE note_uid = ?
    `).run(toIdentity.note_uid)

    expect(() => {
      remapLocalFolderAIPopupRefsNoteUid(fromIdentity.note_uid, toIdentity.note_uid)
    }).toThrow('invalid ai_popup_refs.note_reference')

    const sourceCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = ?
    `).get(fromIdentity.note_uid) as { count: number }
    expect(sourceCount.count).toBe(1)
  })

  it('ignores local-folder popup ref remap when target uid is non-canonical', () => {
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local Remap Alias Guard',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap-alias-guard',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-remap-alias-guard',
    }).notebook
    const fromIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/from.md',
    })
    const toIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/to.md',
    })
    expect(fromIdentity?.note_uid).toBeTruthy()
    expect(toIdentity?.note_uid).toBeTruthy()
    if (!fromIdentity?.note_uid || !toIdentity?.note_uid) return

    const popupId = 'popup-remap-alias-guard'
    createPopup({ id: popupId, prompt: 'p', targetText: 't', actionName: 'Explain' })
    const db = getDb()
    const oldTs = '2020-01-01T00:00:00.000Z'
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run(popupId, fromIdentity.note_uid, oldTs, oldTs)

    const remapped = remapLocalFolderAIPopupRefsNoteUid(
      fromIdentity.note_uid,
      ` ${toIdentity.note_uid} `
    )
    expect(remapped).toBe(0)

    const fromRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder'
        AND note_id = ?
    `).get(fromIdentity.note_uid) as { count: number }
    expect(fromRefCount.count).toBe(1)
  })

  it('returns zero when ai_popup_refs table is unavailable during local-folder remap', () => {
    const db = getDb()
    db.exec('DROP TABLE ai_popup_refs')

    const remapped = remapLocalFolderAIPopupRefsNoteUid(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
    expect(remapped).toBe(0)
  })

  it('rejects internal popup refs for non-existing note references', () => {
    const popupId = 'popup-invalid-internal-note-ref'
    createPopup({
      id: popupId,
      prompt: 'Explain invalid internal',
      targetText: 'invalid internal',
      actionName: 'Explain',
    })

    expect(() => {
      replaceAIPopupRefsForNote({
        note_id: 'note-missing-reference',
        source_type: 'internal',
        popup_ids: [popupId],
      })
    }).toThrow('invalid ai_popup_refs.note_reference')
  })

  it('does not trim note_id aliases when replacing refs', () => {
    const popupId = 'popup-note-id-alias'
    createPopup({
      id: popupId,
      prompt: 'Explain alias',
      targetText: 'alias target',
      actionName: 'Explain',
    })

    const internal = addNote({
      title: 'Internal Alias Guard',
      content: JSON.stringify({ type: 'doc', content: [] }),
    })
    expect(() => {
      replaceAIPopupRefsForNote({
        note_id: ` ${internal.id} `,
        source_type: 'internal',
        popup_ids: [popupId],
      })
    }).toThrow('invalid ai_popup_refs.note_reference')

    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local Alias Guard',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-alias',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-alias',
    }).notebook
    const localIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/alias.md',
    })
    expect(localIdentity?.note_uid).toBeTruthy()

    expect(() => {
      replaceAIPopupRefsForNote({
        note_id: ` ${localIdentity?.note_uid || ''} `,
        source_type: 'local-folder',
        popup_ids: [popupId],
      })
    }).toThrow('invalid ai_popup_refs.note_reference')
  })

  it('accepts uppercase UUID note_id alias for local-folder refs', () => {
    const localNotebook = createLocalFolderNotebookMount({
      name: 'Local UUID Case',
      root_path: '/tmp/sanqian-db-ai-popup-refs-local-uuid-case',
      canonical_root_path: '/tmp/sanqian-db-ai-popup-refs-local-uuid-case',
    }).notebook
    const localIdentity = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/case.md',
    })
    expect(localIdentity?.note_uid).toBeTruthy()

    const popupId = 'popup-local-uuid-case'
    createPopup({
      id: popupId,
      prompt: 'Explain local uuid case',
      targetText: 'local uuid case',
      actionName: 'Explain',
    })

    const inserted = replaceAIPopupRefsForNote({
      note_id: (localIdentity?.note_uid || '').toUpperCase(),
      source_type: 'local-folder',
      popup_ids: [popupId],
    })
    expect(inserted).toBeGreaterThanOrEqual(1)

    const db = getDb()
    const refs = db.prepare(`
      SELECT popup_id
      FROM ai_popup_refs
      WHERE note_id = ? AND source_type = 'local-folder'
      ORDER BY popup_id
    `).all(localIdentity?.note_uid || '') as Array<{ popup_id: string }>
    expect(refs.map((row) => row.popup_id)).toEqual([popupId])
  })

  it('does not trim popup_id aliases when replacing refs', () => {
    const popupId = 'popup-id-alias'
    createPopup({
      id: popupId,
      prompt: 'Explain popup alias',
      targetText: 'popup alias',
      actionName: 'Explain',
    })

    const internal = addNote({
      title: 'Popup Alias Guard',
      content: JSON.stringify({ type: 'doc', content: [] }),
    })
    const inserted = replaceAIPopupRefsForNote({
      note_id: internal.id,
      source_type: 'internal',
      popup_ids: [` ${popupId} `],
    })
    expect(inserted).toBe(0)

    const db = getDb()
    const refs = db.prepare(`
      SELECT popup_id
      FROM ai_popup_refs
      WHERE note_id = ? AND source_type = 'internal'
      ORDER BY popup_id
    `).all(internal.id) as Array<{ popup_id: string }>
    expect(refs).toEqual([])
  })

  it('rejects local-folder popup refs for non-existing local identities', () => {
    const popupId = 'popup-invalid-local-note-ref'
    createPopup({
      id: popupId,
      prompt: 'Explain invalid local',
      targetText: 'invalid local',
      actionName: 'Explain',
    })

    expect(() => {
      replaceAIPopupRefsForNote({
        note_id: 'uid-missing-reference',
        source_type: 'local-folder',
        popup_ids: [popupId],
      })
    }).toThrow('invalid ai_popup_refs.note_reference')
  })

  it('rejects SQL-level popup refs that point to missing popups', () => {
    const now = new Date().toISOString()
    const note = addNote({
      title: 'Popup Ref Guard',
      content: JSON.stringify({ type: 'doc', content: [] }),
    })
    const db = getDb()

    expect(() => {
      db.prepare(`
        INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('popup-missing-reference', note.id, 'internal', now, now)
    }).toThrow('invalid ai_popup_refs.popup_reference')
  })

  it('rejects explicit invalid source_type for replace instead of silently coercing to internal', () => {
    expect(() => {
      replaceAIPopupRefsForNote({
        note_id: 'note-invalid-source-type',
        source_type: 'external' as unknown as 'internal' | 'local-folder',
        popup_ids: ['popup-any'],
      })
    }).toThrow('invalid ai_popup_refs.source_type')
  })

  it('rejects source_type with surrounding spaces instead of trimming', () => {
    expect(() => {
      replaceAIPopupRefsForNote({
        note_id: 'note-invalid-source-space',
        source_type: ' internal ' as unknown as 'internal' | 'local-folder',
        popup_ids: ['popup-any'],
      })
    }).toThrow('invalid ai_popup_refs.source_type')
    expect(() => {
      deleteAIPopupRefsForNote({
        note_id: 'note-invalid-source-space',
        source_type: ' local-folder ' as unknown as 'internal' | 'local-folder',
      })
    }).toThrow('invalid ai_popup_refs.source_type')
  })

  it('rejects missing source_type for replace', () => {
    expect(() => {
      replaceAIPopupRefsForNote({
        note_id: 'note-missing-source-type',
        popup_ids: ['popup-any'],
      } as unknown as Parameters<typeof replaceAIPopupRefsForNote>[0])
    }).toThrow('ai_popup_refs.source_type is required')
  })

  it('rejects explicit invalid source_type for delete instead of silently broad-deleting', () => {
    expect(() => {
      deleteAIPopupRefsForNote({
        note_id: 'note-invalid-source-type',
        source_type: '' as unknown as 'internal' | 'local-folder',
      })
    }).toThrow('invalid ai_popup_refs.source_type')
  })

  it('addNotesBatch inserts notes and popup refs in one batch transaction', () => {
    const popupA = 'popup-batch-a'
    const popupB = 'popup-batch-b'
    createPopup({
      id: popupA,
      prompt: 'A',
      targetText: 'A',
      actionName: 'Explain',
    })
    createPopup({
      id: popupB,
      prompt: 'B',
      targetText: 'B',
      actionName: 'Explain',
    })

    const notes = addNotesBatch([
      {
        title: 'Batch Note A',
        content: buildPopupMarkedDoc(popupA),
      },
      {
        title: 'Batch Note B',
        content: buildPopupMarkedDoc(popupB),
      },
    ])

    expect(notes).toHaveLength(2)
    const db = getDb()
    const refCount = db.prepare(`SELECT COUNT(*) AS cnt FROM ai_popup_refs WHERE source_type = 'internal'`).get() as { cnt: number }
    expect(refCount.cnt).toBeGreaterThanOrEqual(2)
  })

  it('addNotesBatch keeps database unchanged when target notebook is invalid', () => {
    const db = getDb()
    const before = db.prepare('SELECT COUNT(*) AS cnt FROM notes').get() as { cnt: number }

    expect(() => {
      addNotesBatch([
        {
          title: 'Valid Candidate',
          content: JSON.stringify({ type: 'doc', content: [] }),
        },
        {
          title: 'Invalid Notebook',
          content: JSON.stringify({ type: 'doc', content: [] }),
          notebook_id: 'missing-notebook-id',
        },
      ])
    }).toThrow('Cannot assign note to notebook')

    const after = db.prepare('SELECT COUNT(*) AS cnt FROM notes').get() as { cnt: number }
    expect(after.cnt).toBe(before.cnt)
  })
})
