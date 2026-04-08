import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNote,
  addNotebook,
  closeDatabase,
  createLocalFolderNotebookMount,
  createLocalFolderNotebookMountSafe,
  deleteInternalNotebookWithNotes,
  deleteLocalFolderNotebook,
  deleteNote,
  getLocalFolderMountByCanonicalPath,
  getLocalFolderMountByNotebookId,
  getNoteById,
  getNotebooks,
  initDatabase,
  moveNote,
  reorderNotebooks,
  renameNotebookFolderEntry,
  updateLocalFolderMountRoot,
  updateLocalFolderMountStatus,
  updateNote,
  updateNoteSafe,
  updateNotebook as updateNotebookRecord,
} from '../database'
import { getDb } from '../database/connection'

const removeDbFiles = (dir: string) => {
  rmSync(join(dir, 'notes.db'), { force: true })
  rmSync(join(dir, 'notes.db-wal'), { force: true })
  rmSync(join(dir, 'notes.db-shm'), { force: true })
}

const require = createRequire(import.meta.url)
let sqliteAvailable = false

try {
  const BetterSqlite = require('better-sqlite3')
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[Database Move/Folder Tests] better-sqlite3 unavailable, skipping tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Move/Folder Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

let localMountSeed = 0
function createLocalNotebook(name: string): ReturnType<typeof addNotebook> {
  localMountSeed += 1
  const mountPath = `/tmp/sanqian-db-move-and-folder-${localMountSeed}`
  return createLocalFolderNotebookMount({
    name,
    root_path: mountPath,
    canonical_root_path: mountPath,
  }).notebook
}

describeSqlite('database move note and folder rename', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-move-folder-'))

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    closeDatabase()
    removeDbFiles(testDbDir)
    initDatabase()
    localMountSeed = 0
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('rejects moving internal note into local-folder notebook', () => {
    const internal = addNotebook({ name: 'Internal Source' })
    const localFolder = createLocalNotebook('Local Target')
    const note = addNote({
      title: 'Draft',
      content: '{"type":"doc","content":[]}',
      notebook_id: internal.id,
      folder_path: 'project/a',
    })

    expect(moveNote(note.id, localFolder.id)).toEqual({
      ok: false,
      error: 'target_not_allowed',
    })

    const unchanged = getNoteById(note.id)
    expect(unchanged?.notebook_id).toBe(internal.id)
    expect(unchanged?.folder_path).toBe('project/a')
  })

  it('addNotebook rejects local-folder source_type at database boundary', () => {
    expect(() => addNotebook({
      name: 'Local should fail',
      source_type: 'local-folder',
    } as unknown as Parameters<typeof addNotebook>[0])).toThrow(
      'addNotebook only supports internal notebooks'
    )
  })

  it('updateNotebook rejects local-folder source_type updates at database boundary', () => {
    const notebook = addNotebook({ name: 'Internal' })
    expect(() => updateNotebookRecord(
      notebook.id,
      { source_type: 'local-folder' } as unknown as Parameters<typeof updateNotebookRecord>[1]
    )).toThrow(
      'updateNotebook does not support source_type updates'
    )
  })

  it('reorderNotebooks rejects duplicate ids and keeps existing order intact', () => {
    const first = addNotebook({ name: 'First' })
    const second = addNotebook({ name: 'Second' })

    expect(() => reorderNotebooks([first.id, first.id])).toThrow('reorderNotebooks: duplicate id')

    const ordered = getNotebooks()
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((notebook) => notebook.id)

    expect(ordered).toEqual([first.id, second.id])
  })

  it('updateLocalFolderMountStatus no-ops when status is unchanged', () => {
    const localFolder = createLocalNotebook('Local Source')
    const db = getDb()
    const pinnedUpdatedAt = '2000-01-01T00:00:00.000Z'
    db.prepare(`
      UPDATE local_folder_mounts
      SET updated_at = ?
      WHERE notebook_id = ?
    `).run(pinnedUpdatedAt, localFolder.id)

    const updated = updateLocalFolderMountStatus(localFolder.id, 'active')
    expect(updated).toBe('no_change')

    const mount = getLocalFolderMountByNotebookId(localFolder.id)
    expect(mount).not.toBeNull()
    expect(mount?.status).toBe('active')
    expect(mount?.updated_at).toBe(pinnedUpdatedAt)
  })

  it('updateLocalFolderMountStatus updates timestamp when status changes', () => {
    const localFolder = createLocalNotebook('Local Source')
    const db = getDb()
    const pinnedUpdatedAt = '2000-01-01T00:00:00.000Z'
    db.prepare(`
      UPDATE local_folder_mounts
      SET updated_at = ?
      WHERE notebook_id = ?
    `).run(pinnedUpdatedAt, localFolder.id)

    const updated = updateLocalFolderMountStatus(localFolder.id, 'missing')
    expect(updated).toBe('updated')

    const mount = getLocalFolderMountByNotebookId(localFolder.id)
    expect(mount).not.toBeNull()
    expect(mount?.status).toBe('missing')
    expect(mount?.updated_at).not.toBe(pinnedUpdatedAt)
  })

  it('updateLocalFolderMountRoot returns conflict when duplicate exists even if duplicate is non-active', () => {
    const primary = createLocalNotebook('Primary')
    const duplicate = createLocalNotebook('Duplicate Missing')
    const db = getDb()
    const canonicalPath = '/tmp/sanqian-db-legacy-duplicate-relink'
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE local_folder_mounts
      SET root_path = ?, canonical_root_path = ?, canonical_compare_path = ?, status = 'missing', updated_at = ?
      WHERE notebook_id = ?
    `).run(canonicalPath, canonicalPath, canonicalPath, now, duplicate.id)

    const updateResult = updateLocalFolderMountRoot({
      notebook_id: primary.id,
      root_path: canonicalPath,
      canonical_root_path: canonicalPath,
      status: 'active',
    })
    expect(updateResult).toEqual({ status: 'conflict' })
  })

  it('updateLocalFolderMountRoot returns conflict when another active mount owns the canonical path', () => {
    const primary = createLocalNotebook('Primary')
    const activeOwner = createLocalNotebook('Active Owner')

    const conflictResult = updateLocalFolderMountRoot({
      notebook_id: primary.id,
      root_path: `/tmp/sanqian-db-conflict-${activeOwner.id}`,
      canonical_root_path: `/tmp/sanqian-db-move-and-folder-${localMountSeed}`,
      status: 'active',
    })

    expect(conflictResult).toEqual({ status: 'conflict' })
  })

  it('updateLocalFolderMountRoot returns not_found for missing notebook mount', () => {
    const result = updateLocalFolderMountRoot({
      notebook_id: 'nb-missing',
      root_path: '/tmp/sanqian-db-missing',
      canonical_root_path: '/tmp/sanqian-db-missing',
      status: 'active',
    })
    expect(result).toEqual({ status: 'not_found' })
  })

  it('createLocalFolderNotebookMountSafe returns conflict for duplicate canonical path', () => {
    const owner = createLocalNotebook('Owner')
    const ownerMount = getLocalFolderMountByNotebookId(owner.id)
    expect(ownerMount).not.toBeNull()
    if (!ownerMount) throw new Error('missing owner mount')

    const notebookCountBefore = getNotebooks().length
    const conflict = createLocalFolderNotebookMountSafe({
      name: 'Duplicate Candidate',
      root_path: '/tmp/sanqian-db-safe-create-duplicate',
      canonical_root_path: ownerMount.canonical_root_path,
      status: 'active',
    })

    expect(conflict).toEqual({ status: 'conflict' })
    expect(getNotebooks().length).toBe(notebookCountBefore)
  })

  it('createLocalFolderNotebookMountSafe still detects conflict when stored canonical root is whitespace', () => {
    const owner = createLocalNotebook('Owner')
    const ownerMount = getLocalFolderMountByNotebookId(owner.id)
    expect(ownerMount).not.toBeNull()
    if (!ownerMount) throw new Error('missing owner mount')

    const db = getDb()
    db.prepare(`
      UPDATE local_folder_mounts
      SET canonical_root_path = ?, canonical_compare_path = ?
      WHERE notebook_id = ?
    `).run('   ', '   ', owner.id)

    const matched = getLocalFolderMountByCanonicalPath(ownerMount.root_path)
    expect(matched?.notebook_id).toBe(owner.id)

    const conflict = createLocalFolderNotebookMountSafe({
      name: 'Whitespace Canonical Duplicate',
      root_path: '/tmp/sanqian-db-safe-create-duplicate-whitespace',
      canonical_root_path: ownerMount.root_path,
      status: 'active',
    })

    expect(conflict).toEqual({ status: 'conflict' })
  })

  it('createLocalFolderNotebookMount keeps throwing sqlite conflict for compatibility', () => {
    const owner = createLocalNotebook('Owner')
    const ownerMount = getLocalFolderMountByNotebookId(owner.id)
    expect(ownerMount).not.toBeNull()
    if (!ownerMount) throw new Error('missing owner mount')

    try {
      createLocalFolderNotebookMount({
        name: 'Legacy Duplicate',
        root_path: '/tmp/sanqian-db-legacy-create-duplicate',
        canonical_root_path: ownerMount.canonical_root_path,
        status: 'active',
      })
      throw new Error('expected duplicate mount creation to throw')
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('SQLITE_CONSTRAINT_UNIQUE')
    }
  })

  it('updateNote rejects assigning notebook_id to local-folder notebook', () => {
    const internal = addNotebook({ name: 'Internal Source' })
    const localFolder = createLocalNotebook('Local Target')
    const note = addNote({
      title: 'Draft',
      content: '{"type":"doc","content":[]}',
      notebook_id: internal.id,
      folder_path: 'project/a',
    })

    const updated = updateNote(note.id, { notebook_id: localFolder.id })
    expect(updated).toBeNull()

    const unchanged = getNoteById(note.id)
    expect(unchanged?.notebook_id).toBe(internal.id)
    expect(unchanged?.folder_path).toBe('project/a')
  })

  it('updateNoteSafe rejects assigning notebook_id to local-folder notebook', () => {
    const internal = addNotebook({ name: 'Internal Source' })
    const localFolder = createLocalNotebook('Local Target')
    const note = addNote({
      title: 'Draft',
      content: '{"type":"doc","content":[]}',
      notebook_id: internal.id,
      folder_path: 'project/a',
    })

    const result = updateNoteSafe(note.id, { notebook_id: localFolder.id }, note.revision)
    expect(result).toEqual({ status: 'failed', error: 'target_not_allowed' })

    const unchanged = getNoteById(note.id)
    expect(unchanged?.notebook_id).toBe(internal.id)
    expect(unchanged?.folder_path).toBe('project/a')
  })

  it('clears folder_path when moving note across notebooks or out of notebook', () => {
    const sourceNotebook = addNotebook({ name: 'Source' })
    const targetNotebook = addNotebook({ name: 'Target' })

    const first = addNote({
      title: 'Cross Notebook',
      content: '{"type":"doc","content":[]}',
      notebook_id: sourceNotebook.id,
      folder_path: 'alpha/beta',
    })

    expect(moveNote(first.id, targetNotebook.id)).toEqual({ ok: true })
    const moved = getNoteById(first.id)
    expect(moved?.notebook_id).toBe(targetNotebook.id)
    expect(moved?.folder_path).toBeNull()

    const second = addNote({
      title: 'To Inbox',
      content: '{"type":"doc","content":[]}',
      notebook_id: sourceNotebook.id,
      folder_path: 'daily',
    })
    expect(moveNote(second.id, null)).toEqual({ ok: true })
    const detached = getNoteById(second.id)
    expect(detached?.notebook_id).toBeNull()
    expect(detached?.folder_path).toBeNull()
  })

  it('bumps revision when moveNote succeeds', () => {
    const sourceNotebook = addNotebook({ name: 'Source' })
    const targetNotebook = addNotebook({ name: 'Target' })
    const note = addNote({
      title: 'Revision Move',
      content: '{"type":"doc","content":[]}',
      notebook_id: sourceNotebook.id,
      folder_path: 'alpha',
    })

    expect(moveNote(note.id, targetNotebook.id)).toEqual({ ok: true })
    const moved = getNoteById(note.id)
    expect(moved).not.toBeNull()
    expect(moved?.revision).toBe(note.revision + 1)
  })

  it('clears stale folder_path even when moving detached note to null again', () => {
    const dirty = addNote({
      title: 'Legacy Dirty',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      folder_path: 'legacy/dirty',
    })

    expect(moveNote(dirty.id, null)).toEqual({ ok: true })
    const healed = getNoteById(dirty.id)
    expect(healed?.notebook_id).toBeNull()
    expect(healed?.folder_path).toBeNull()
  })

  it('deleteInternalNotebookWithNotes soft-deletes active notes and deletes notebook in one transaction', () => {
    const notebook = addNotebook({ name: 'Internal Delete Transaction' })
    const active1 = addNote({
      title: 'Active 1',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: 'project/a',
    })
    const active2 = addNote({
      title: 'Active 2',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: null,
    })
    const trashed = addNote({
      title: 'Already Trashed',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: 'project/z',
    })
    expect(deleteNote(trashed.id)).toBe(true)

    const deleted = deleteInternalNotebookWithNotes({ notebook_id: notebook.id })
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return

    expect(new Set(deleted.value.deleted_note_ids)).toEqual(new Set([active1.id, active2.id]))
    expect(deleted.value.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(getNotebooks().find((item) => item.id === notebook.id)).toBeUndefined()

    const active1After = getNoteById(active1.id)
    const active2After = getNoteById(active2.id)
    const trashedAfter = getNoteById(trashed.id)

    expect(active1After?.deleted_at).toBe(deleted.value.deleted_at)
    expect(active2After?.deleted_at).toBe(deleted.value.deleted_at)
    expect(active1After?.notebook_id).toBeNull()
    expect(active2After?.notebook_id).toBeNull()
    expect(active1After?.folder_path).toBeNull()
    expect(active2After?.folder_path).toBeNull()
    expect(trashedAfter?.deleted_at).not.toBeNull()
    expect(trashedAfter?.notebook_id).toBeNull()
    expect(trashedAfter?.folder_path).toBeNull()
  })

  it('deleteInternalNotebookWithNotes rejects local-folder notebooks', () => {
    const localNotebook = createLocalNotebook('Local Notebook')

    expect(deleteInternalNotebookWithNotes({ notebook_id: localNotebook.id })).toEqual({
      ok: false,
      error: 'notebook_not_internal',
    })
    expect(getNotebooks().some((item) => item.id === localNotebook.id)).toBe(true)
  })

  it('deleteInternalNotebookWithNotes returns not_found for unknown notebook', () => {
    expect(deleteInternalNotebookWithNotes({ notebook_id: 'nb-missing' })).toEqual({
      ok: false,
      error: 'notebook_not_found',
    })
  })

  it('deleteLocalFolderNotebook deletes local notebook', () => {
    const localNotebook = createLocalNotebook('Local Mount')

    expect(deleteLocalFolderNotebook(localNotebook.id)).toEqual({ ok: true })
    expect(getNotebooks().some((item) => item.id === localNotebook.id)).toBe(false)
  })

  it('deleteLocalFolderNotebook rejects internal notebook', () => {
    const internalNotebook = addNotebook({ name: 'Internal Notebook' })
    expect(deleteLocalFolderNotebook(internalNotebook.id)).toEqual({
      ok: false,
      error: 'notebook_not_local_folder',
    })
    expect(getNotebooks().some((item) => item.id === internalNotebook.id)).toBe(true)
  })

  it('deleteLocalFolderNotebook returns not_found for unknown notebook', () => {
    expect(deleteLocalFolderNotebook('nb-missing')).toEqual({
      ok: false,
      error: 'notebook_not_found',
    })
  })

  it('ignores trashed-note conflicts when renaming notebook folder', () => {
    const notebook = addNotebook({ name: 'Workspace' })
    const active = addNote({
      title: 'Active Note',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: 'old-folder',
    })
    const trashedConflict = addNote({
      title: 'Trashed Destination',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: 'new-folder',
    })
    expect(deleteNote(trashedConflict.id)).toBe(true)

    const renamed = renameNotebookFolderEntry({
      notebook_id: notebook.id,
      folder_path: 'old-folder',
      next_folder_path: 'new-folder',
    })

    expect(renamed).toEqual({ ok: true })
    expect(getNoteById(active.id)?.folder_path).toBe('new-folder')
  })
})
